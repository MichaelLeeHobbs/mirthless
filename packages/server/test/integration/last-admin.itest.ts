// ===========================================
// Last enabled admin: concurrent demotions (real Postgres, #218)
// ===========================================
// Two admins disabling or demoting each other at the same moment must not both
// succeed: the check for another enabled admin and the write happen in one
// transaction that holds the lock on the admin role row (grant.service). Each round starts with exactly
// two enabled admins (any other enabled admin is set aside for the test and
// put back after), fires both changes with Promise.all, and expects exactly one
// to succeed and one enabled admin to remain.

import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from 'vitest';
import { describeIntegration } from './_setup.js';

const ROUNDS = 10;
/** Users holding the admin role through a live assignment. */
const ADMIN_HOLDERS = `SELECT a.user_id FROM assignments a JOIN roles r ON r.id = a.role_id
  WHERE r.admin AND (a.expires_at IS NULL OR a.expires_at > now())`;

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
      `UPDATE users SET enabled = false WHERE enabled = true AND id IN (${ADMIN_HOLDERS}) RETURNING id`,
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
      `INSERT INTO users (username, email, password_hash, enabled)
       VALUES ($1, $2, 'not-a-real-hash', true) RETURNING id`,
      [name, `${name}@example.test`],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('admin insert returned no id');
    await pool.query(`INSERT INTO assignments (user_id, role_id) SELECT $1, id FROM roles WHERE admin`, [id]);
    created.push(id);
    return id;
  }

  async function enabledAdminCount(): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM users WHERE enabled = true AND id IN (${ADMIN_HOLDERS})`);
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
      const refused = results.find((r) => !r.ok);
      expect(refused && !refused.ok ? (refused.error as { code?: string }).code : undefined).toBe('CONFLICT');
      expect(await enabledAdminCount()).toBe(1);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[a, b]]);
      created.length = 0;
    }
  });
});
