// ===========================================
// Users and their roles (real Postgres, #265 slice 6)
// ===========================================
// A user's role is an assignment the grant service writes, with its audit row,
// in the same transaction as the change. The last enabled admin is protected
// under the admin role lock. Concurrency is in last-admin.itest.ts.

import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeIntegration } from './_setup.js';

describeIntegration('UserService roles (real Postgres)', () => {
  let UserService: typeof import('../../src/services/user.service.js').UserService;
  let pool: typeof import('../../src/lib/db.js').pool;
  const created: string[] = [];
  let setAside: string[] = [];

  const ADMIN_HOLDERS = `SELECT a.user_id FROM assignments a JOIN roles r ON r.id = a.role_id
    WHERE r.admin AND (a.expires_at IS NULL OR a.expires_at > now())`;

  beforeAll(async () => {
    ({ UserService } = await import('../../src/services/user.service.js'));
    ({ pool } = await import('../../src/lib/db.js'));
  });

  beforeEach(async () => {
    // Each test decides who the enabled admins are; any others are put back after.
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

  const tag = (): string => `itest-roles-${randomUUID().slice(0, 8)}`;

  async function createUser(role: string, opts: { expiresAt?: Date } = {}): Promise<string> {
    const name = tag();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'not-a-hash') RETURNING id`,
      [name, `${name}@example.test`],
    );
    const id = rows[0]!.id;
    created.push(id);
    await pool.query(
      `INSERT INTO assignments (user_id, role_id, expires_at) SELECT $1, id, $3 FROM roles WHERE name = $2`,
      [id, role, opts.expiresAt ?? null],
    );
    return id;
  }

  async function heldRoles(userId: string): Promise<string[]> {
    const { rows } = await pool.query<{ name: string }>(
      `SELECT r.name FROM assignments a JOIN roles r ON r.id = a.role_id WHERE a.user_id = $1 ORDER BY r.name`, [userId],
    );
    return rows.map((r) => r.name);
  }

  async function assignmentAudits(userId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await pool.query<{ attributes: Record<string, unknown> }>(
      `SELECT attributes FROM audit_log WHERE action = 'ASSIGNMENTS_CHANGED' AND attributes->>'targetUserId' = $1 ORDER BY id`, [userId],
    );
    return rows.map((r) => r.attributes);
  }

  async function sessionCount(userId: string): Promise<number> {
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM sessions WHERE user_id = $1', [userId]);
    return Number(rows[0]?.n);
  }

  async function addSession(userId: string): Promise<void> {
    await pool.query(
      `INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [userId, `itest-${randomUUID()}`],
    );
  }

  describe('createUser', () => {
    it('gives the new user one all-channel assignment of the role, recorded in the same transaction', async () => {
      const actor = await createUser('admin');
      const name = tag();
      const result = await UserService.createUser(
        { username: name, email: `${name}@example.test`, password: 'password123', role: 'channel-viewer' },
        { userId: actor, ipAddress: '127.0.0.1' },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      created.push(result.value.id);
      expect(result.value).toMatchObject({ role: 'channel-viewer', roles: ['channel-viewer'] });
      expect(await heldRoles(result.value.id)).toEqual(['channel-viewer']);
      expect(await assignmentAudits(result.value.id)).toEqual([{ targetUserId: result.value.id, before: [], after: [{ roleId: expect.any(String), role: 'channel-viewer', scope: 'all' }] }]);
    });

    it('refuses a role that does not exist and creates no user', async () => {
      const name = tag();
      const result = await UserService.createUser({ username: name, email: `${name}@example.test`, password: 'password123', role: 'wizard' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'INVALID_INPUT');
      const { rowCount } = await pool.query('SELECT 1 FROM users WHERE username = $1', [name]);
      expect(rowCount).toBe(0);
    });
  });

  describe('updateUser', () => {
    it('replaces the user\'s assignments with the new role and records before and after', async () => {
      const actor = await createUser('admin');
      const target = await createUser('developer');
      const result = await UserService.updateUser(target, { role: 'viewer' }, actor, { userId: actor, ipAddress: null });
      expect(result.ok).toBe(true);
      expect(await heldRoles(target)).toEqual(['viewer']);
      expect(await assignmentAudits(target)).toEqual([{ targetUserId: target, before: ['developer'], after: [{ roleId: expect.any(String), role: 'viewer', scope: 'all' }] }]);
    });

    it('writes nothing when the role is the one already held', async () => {
      const actor = await createUser('admin');
      const target = await createUser('viewer');
      expect((await UserService.updateUser(target, { role: 'viewer' }, actor)).ok).toBe(true);
      expect(await assignmentAudits(target)).toEqual([]);
    });

    it('refuses a change to the actor\'s own role', async () => {
      const actor = await createUser('admin');
      await createUser('admin');
      const result = await UserService.updateUser(actor, { role: 'viewer' }, actor);
      expect(!result.ok && (result.error as { code?: string }).code).toBe('SELF_ACTION');
      expect(await heldRoles(actor)).toEqual(['admin']);
    });

    /** An actor who may act on an admin (the target rule) but does not count as the admin who remains. */
    const temporaryAdmin = (): Promise<string> => createUser('admin', { expiresAt: new Date(Date.now() + 3_600_000) });

    it('refuses to demote or disable the last enabled admin, and writes nothing', async () => {
      const only = await createUser('admin');
      const actor = await temporaryAdmin();
      for (const input of [{ role: 'viewer' }, { enabled: false }]) {
        const result = await UserService.updateUser(only, input, actor);
        expect(!result.ok && (result.error as { code?: string }).code, JSON.stringify(input)).toBe('CONFLICT');
      }
      expect(await heldRoles(only)).toEqual(['admin']);
      const { rows } = await pool.query<{ enabled: boolean }>('SELECT enabled FROM users WHERE id = $1', [only]);
      expect(rows[0]?.enabled).toBe(true);
    });

    it('does not count an expired admin assignment as another admin', async () => {
      const only = await createUser('admin');
      await createUser('admin', { expiresAt: new Date(Date.now() - 60_000) });
      const result = await UserService.updateUser(only, { enabled: false }, await temporaryAdmin());
      expect(!result.ok && (result.error as { code?: string }).code).toBe('CONFLICT');
    });

    it('does not count a time-limited admin as the admin who remains, since it will lapse', async () => {
      const lasting = await createUser('admin');
      const temporary = await createUser('admin', { expiresAt: new Date(Date.now() + 3_600_000) });
      const result = await UserService.updateUser(lasting, { enabled: false }, temporary);
      expect(!result.ok && (result.error as { code?: string }).code).toBe('CONFLICT');
    });

    it('lets a time-limited admin be disabled while a lasting admin remains', async () => {
      const lasting = await createUser('admin');
      const temporary = await createUser('admin', { expiresAt: new Date(Date.now() + 3_600_000) });
      expect((await UserService.updateUser(temporary, { enabled: false }, lasting)).ok).toBe(true);
    });

    it('disables an admin when another enabled admin remains, and ends their sessions', async () => {
      const target = await createUser('admin');
      const actor = await createUser('admin');
      await addSession(target);
      const result = await UserService.updateUser(target, { enabled: false }, actor);
      expect(result.ok).toBe(true);
      expect(await sessionCount(target)).toBe(0);
    });
  });

  describe('deleteUser', () => {
    it('refuses to delete the last enabled admin', async () => {
      const only = await createUser('admin');
      const actor = await createUser('admin', { expiresAt: new Date(Date.now() + 3_600_000) });
      const result = await UserService.deleteUser(only, actor);
      expect(!result.ok && (result.error as { code?: string }).code).toBe('CONFLICT');
    });

    it('disables a user and ends their sessions', async () => {
      const actor = await createUser('admin');
      const target = await createUser('developer');
      await addSession(target);
      expect((await UserService.deleteUser(target, actor)).ok).toBe(true);
      expect(await sessionCount(target)).toBe(0);
    });

    it('answers NOT_FOUND for a user that does not exist', async () => {
      const actor = await createUser('admin');
      const result = await UserService.deleteUser(randomUUID(), actor);
      expect(!result.ok && (result.error as { code?: string }).code).toBe('NOT_FOUND');
    });
  });
});
