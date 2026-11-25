// Regression suite for #174.

import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import { describeIntegration, waitForBlocked } from './_setup.js';

const PASSWORD = 'Correct-horse-1';
const GUESSES = 10;

describeIntegration('AuthService concurrency (real Postgres)', () => {
  let AuthService: typeof import('../../src/services/auth.service.js').AuthService;
  let pool: typeof import('../../src/lib/db.js').pool;
  const created: string[] = [];

  beforeAll(async () => {
    ({ AuthService } = await import('../../src/services/auth.service.js'));
    ({ pool } = await import('../../src/lib/db.js'));
  });

  afterEach(async () => {
    // Sessions cascade with the user.
    if (created.length > 0) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [created]);
    created.length = 0;
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function createUser(lock?: { attempts: number; lockedUntil: Date }): Promise<{ id: string; username: string }> {
    const username = `itest-auth-${String(Date.now())}-${String(created.length)}`;
    const hash = await bcrypt.hash(PASSWORD, 4);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (username, email, password_hash, failed_login_attempts, locked_until)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [username, `${username}@example.test`, hash, lock?.attempts ?? 0, lock?.lockedUntil ?? null],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('user insert returned no id');
    created.push(id);
    return { id, username };
  }

  async function lockState(id: string): Promise<{ attempts: number; lockedUntil: Date | null }> {
    const { rows } = await pool.query<{ failed_login_attempts: number; locked_until: Date | null }>(
      'SELECT failed_login_attempts, locked_until FROM users WHERE id = $1', [id],
    );
    return { attempts: rows[0]?.failed_login_attempts ?? -1, lockedUntil: rows[0]?.locked_until ?? null };
  }

  const code = (r: { ok: boolean; error?: unknown }): string | undefined => (r.ok ? undefined : (r.error as { code?: string }).code);

  it('counts every one of ten concurrent wrong guesses up to the lock, and the lock holds', async () => {
    const { id, username } = await createUser();

    const results = await Promise.all(Array.from({ length: GUESSES }, () => AuthService.login(username, 'wrong-password')));

    const state = await lockState(id);
    expect(state.lockedUntil?.getTime() ?? 0, 'the account ends locked').toBeGreaterThan(Date.now());
    // Each guess counted until one reached five; later ones found the lock.
    expect(state.attempts).toBe(5);
    expect(results.filter((r) => code(r) === 'INVALID_CREDENTIALS')).toHaveLength(4);
    expect(results.filter((r) => code(r) === 'ACCOUNT_LOCKED')).toHaveLength(GUESSES - 4);
    expect(code(await AuthService.login(username, PASSWORD))).toBe('ACCOUNT_LOCKED');
  });

  it('refuses the correct password when the account is locked while that password is being checked', async () => {
    const { id, username } = await createUser();
    const lockedUntil = new Date(Date.now() + 60_000);
    const client = await pool.connect();
    let login: ReturnType<typeof AuthService.login>;
    try {
      // Uncommitted, so login reads an unlocked account, then waits here to record the sign-in.
      await client.query('BEGIN');
      await client.query('UPDATE users SET failed_login_attempts = 5, locked_until = $2 WHERE id = $1', [id, lockedUntil]);
      login = AuthService.login(username, PASSWORD);
      await waitForBlocked(pool, 'update "users"');
      await client.query('COMMIT');
    } finally {
      // Dropped, not reused: if the wait failed, its transaction is still open.
      client.release(true);
    }

    expect(code(await login)).toBe('ACCOUNT_LOCKED');
    expect(await lockState(id)).toEqual({ attempts: 5, lockedUntil });
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM sessions WHERE user_id = $1', [id]);
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('signs in with the correct password after a lock expires, and clears the count', async () => {
    const { id, username } = await createUser({ attempts: 5, lockedUntil: new Date(Date.now() - 1000) });

    expect((await AuthService.login(username, PASSWORD)).ok).toBe(true);

    expect(await lockState(id)).toEqual({ attempts: 0, lockedUntil: null });
  });

  it('starts a new count after a lock expires, so one wrong guess does not lock again', async () => {
    const { id, username } = await createUser({ attempts: 5, lockedUntil: new Date(Date.now() - 1000) });

    expect(code(await AuthService.login(username, 'wrong-password'))).toBe('INVALID_CREDENTIALS');

    expect(await lockState(id)).toEqual({ attempts: 1, lockedUntil: null });
  });

  it('lets only one of two concurrent refreshes with the same token rotate it', async () => {
    const { id, username } = await createUser();
    const login = await AuthService.login(username, PASSWORD);
    if (!login.ok) throw new Error(`login failed: ${login.error.message}`);

    const results = await Promise.all([
      AuthService.refreshSession(login.value.refreshToken),
      AuthService.refreshSession(login.value.refreshToken),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM sessions WHERE user_id = $1', [id]);
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
