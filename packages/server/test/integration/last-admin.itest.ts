// ===========================================
// Last enabled admin: concurrent demotions (real Postgres, #218)
// ===========================================
// Two admins disabling or demoting each other at the same moment must not both
// succeed: the check for another enabled admin and the write happen in one
// transaction that locks the enabled admin rows. Each round starts with exactly
// two enabled admins (any other enabled admin is set aside for the test and
// put back after), fires both changes with Promise.all, and expects exactly one
// to succeed and one enabled admin to remain.

import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from 'vitest';
import { describeIntegration } from './_setup.js';

const ROUNDS = 10;

describeIntegration('UserService last enabled admin (real Postgres)', () => {
  let UserService: typeof import('../../src/services/user.service.js').UserService;
  let pool: typeof import('../../src/lib/db.js').pool;
  let setAside: string[] = [];
  const created: string[] = [];

  beforeAll(async () => {
    ({ UserService } = await import('../../src/services/user.service.js'));
    ({ pool } = await import('../../src/lib/db.js'));
  });

  beforeEach(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE users SET enabled = false WHERE role = 'admin' AND enabled = true RETURNING id`,
    );
    setAside = rows.map((r) => r.id);
  });

  afterEach(async () => {
    if (created.length > 0) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [created]);
    created.length = 0;
    if (setAside.length > 0) await pool.query('UPDATE users SET enabled = true WHERE id = ANY($1::uuid[])', [setAside]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function createAdmin(name: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (username, email, password_hash, role, enabled)
       VALUES ($1, $2, 'not-a-real-hash', 'admin', true) RETURNING id`,
      [name, `${name}@example.test`],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('admin insert returned no id');
    created.push(id);
    return id;
  }

  async function enabledAdminCount(): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM users WHERE role = 'admin' AND enabled = true`);
    return Number(rows[0]?.n ?? 0);
  }

  async function round(i: number, change: 'disable' | 'demote'): Promise<void> {
    const tag = `itest-admin-${change}-${String(Date.now())}-${String(i)}`;
    const a = await createAdmin(`${tag}-a`);
    const b = await createAdmin(`${tag}-b`);
    const input = change === 'disable' ? { enabled: false } : { role: 'viewer' as const };

    const results = await Promise.all([
      UserService.updateUser(a, input, b),
      UserService.updateUser(b, input, a),
    ]);

    expect(results.filter((r) => r.ok), `round ${String(i)}: exactly one ${change} succeeds`).toHaveLength(1);
    const refused = results.find((r) => !r.ok);
    expect(refused && !refused.ok ? (refused.error as { code?: string }).code : undefined).toBe('CONFLICT');
    expect(await enabledAdminCount()).toBe(1);

    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[a, b]]);
    created.length = 0;
  }

  it('lets only one of two admins disable the other at the same moment', async () => {
    for (let i = 0; i < ROUNDS; i++) await round(i, 'disable');
  });

  it('lets only one of two admins demote the other at the same moment', async () => {
    for (let i = 0; i < ROUNDS; i++) await round(i, 'demote');
  });

  it('lets only one of two admins remove the other at the same moment', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const tag = `itest-admin-delete-${String(Date.now())}-${String(i)}`;
      const a = await createAdmin(`${tag}-a`);
      const b = await createAdmin(`${tag}-b`);

      const results = await Promise.all([UserService.deleteUser(a, b), UserService.deleteUser(b, a)]);

      expect(results.filter((r) => r.ok), `round ${String(i)}: exactly one removal succeeds`).toHaveLength(1);
      expect(await enabledAdminCount()).toBe(1);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[a, b]]);
      created.length = 0;
    }
  });
});
