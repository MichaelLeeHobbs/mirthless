// Nobody gives more than they hold (the within rule) or acts on a user holding
// more than they do (the target rule) (#265).

import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { describeIntegration } from './_setup.js';

describeIntegration('roles and grant rules (real Postgres)', () => {
  let GrantService: typeof import('../../src/services/grant.service.js').GrantService;
  let UserService: typeof import('../../src/services/user.service.js').UserService;
  let db: typeof import('../../src/lib/db.js').db;
  let pool: typeof import('../../src/lib/db.js').pool;
  const createdUsers: string[] = [];
  const createdRoles: string[] = [];

  beforeAll(async () => {
    ({ GrantService } = await import('../../src/services/grant.service.js'));
    ({ UserService } = await import('../../src/services/user.service.js'));
    ({ db, pool } = await import('../../src/lib/db.js'));
  });

  afterEach(async () => {
    if (createdUsers.length > 0) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUsers]);
    createdUsers.length = 0;
    if (createdRoles.length > 0) await pool.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [createdRoles]);
    createdRoles.length = 0;
  });

  afterAll(async () => {
    await pool?.end();
  });

  const tag = (): string => `itest-rbac-${randomUUID().slice(0, 8)}`;

  async function userWithRole(role: string): Promise<string> {
    const name = tag();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'not-a-hash') RETURNING id`, [name, `${name}@example.test`],
    );
    const id = rows[0]!.id;
    createdUsers.push(id);
    await pool.query('INSERT INTO assignments (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2', [id, role]);
    return id;
  }

  async function createRole(actor: string, permissions: string[], extra: { clonedFrom?: string } = {}): Promise<string> {
    const id = await db.transaction((tx) => GrantService.createRole(
      tx, { name: tag(), description: '', permissions: permissions as never[], ...extra }, { userId: actor },
    ));
    createdRoles.push(id);
    return id;
  }

  async function lastAudit(action: string, roleId: string): Promise<Record<string, unknown> | undefined> {
    const { rows } = await pool.query<{ attributes: Record<string, unknown> }>(
      `SELECT attributes FROM audit_log WHERE action = $1 AND attributes->>'roleId' = $2 ORDER BY id DESC LIMIT 1`, [action, roleId],
    );
    return rows[0]?.attributes;
  }

  const codeOf = (err: unknown): string | undefined => (err as { code?: string }).code;

  describe('role rows', () => {
    it('creates a role, records it, and lists it with its permissions and holders', async () => {
      const admin = await userWithRole('admin');
      const id = await createRole(admin, ['messages:read', 'channels:read']);
      const role = await GrantService.getRole(id);
      expect(role).toMatchObject({ permissions: ['channels:read', 'messages:read'], holders: 0, builtIn: false, admin: false });
      expect(await lastAudit('ROLE_CREATED', id)).toMatchObject({ roleId: id, permissions: ['channels:read', 'messages:read'] });
    });

    it('records the role a clone came from', async () => {
      const admin = await userWithRole('admin');
      const viewer = (await GrantService.listRoles()).find((r) => r.name === 'viewer')!;
      const id = await createRole(admin, [...viewer.permissions], { clonedFrom: viewer.id });
      expect(await lastAudit('ROLE_CREATED', id)).toMatchObject({ clonedFrom: viewer.id });
    });

    it('refuses a second role with the same name', async () => {
      const admin = await userWithRole('admin');
      await expect(db.transaction((tx) => GrantService.createRole(tx, { name: 'viewer', description: '', permissions: [] }, { userId: admin })))
        .rejects.toSatisfy((e) => codeOf(e) === 'ALREADY_EXISTS');
    });

    it('changes a role\'s permissions and records before and after', async () => {
      const admin = await userWithRole('admin');
      const id = await createRole(admin, ['channels:read']);
      await db.transaction((tx) => GrantService.updateRole(tx, id, { permissions: ['messages:read'] }, { userId: admin }));
      expect((await GrantService.getRole(id)).permissions).toEqual(['messages:read']);
      expect(await lastAudit('ROLE_UPDATED', id)).toMatchObject({
        before: { permissions: ['channels:read'] }, after: { permissions: ['messages:read'] },
      });
    });

    it('locks the admin role against change and deletion', async () => {
      const admin = await userWithRole('admin');
      const adminRole = (await GrantService.listRoles()).find((r) => r.admin)!;
      await expect(db.transaction((tx) => GrantService.updateRole(tx, adminRole.id, { name: 'root' }, { userId: admin })))
        .rejects.toSatisfy((e) => codeOf(e) === 'SYSTEM_PROTECTED');
      await expect(db.transaction((tx) => GrantService.deleteRole(tx, adminRole.id, { userId: admin })))
        .rejects.toSatisfy((e) => codeOf(e) === 'SYSTEM_PROTECTED');
    });

    it('refuses to delete a role still assigned, naming the assignments, and deletes it once free', async () => {
      const admin = await userWithRole('admin');
      const id = await createRole(admin, ['channels:read']);
      const { rows } = await pool.query<{ name: string }>('SELECT name FROM roles WHERE id = $1', [id]);
      const holder = await userWithRole(rows[0]!.name);
      const refused = await db.transaction((tx) => GrantService.deleteRole(tx, id, { userId: admin })).catch((e: unknown) => e);
      expect(codeOf(refused)).toBe('CONFLICT');
      expect((refused as { details?: { assignments: { userId: string }[] } }).details?.assignments.map((a) => a.userId)).toEqual([holder]);

      await pool.query('DELETE FROM assignments WHERE user_id = $1', [holder]);
      await db.transaction((tx) => GrantService.deleteRole(tx, id, { userId: admin }));
      expect(await lastAudit('ROLE_DELETED', id)).toMatchObject({ roleId: id });
    });
  });

  describe('the within rule', () => {
    it('refuses a role with a permission its creator does not hold', async () => {
      const deployer = await userWithRole('deployer');
      const refused = await db.transaction((tx) => GrantService.createRole(
        tx, { name: tag(), description: '', permissions: ['channels:read', 'users:write'] }, { userId: deployer },
      )).catch((e: unknown) => e);
      expect(codeOf(refused)).toBe('FORBIDDEN');
      expect((refused as { details?: { missing: string[] } }).details?.missing).toEqual(['users:write']);
    });

    it('refuses to add a permission the editor lacks, but lets them remove one', async () => {
      const admin = await userWithRole('admin');
      const editor = await userWithRole((await GrantService.getRole(await createRole(admin, ['channels:read', 'roles:write']))).name);
      const id = await createRole(admin, ['channels:read', 'users:read']);
      await expect(db.transaction((tx) => GrantService.updateRole(tx, id, { permissions: ['channels:read', 'users:read', 'users:write'] }, { userId: editor })))
        .rejects.toSatisfy((e) => codeOf(e) === 'FORBIDDEN');
      // Keeping users:read, which the editor lacks, is not adding it.
      await db.transaction((tx) => GrantService.updateRole(tx, id, { permissions: ['users:read'] }, { userId: editor }));
      expect((await GrantService.getRole(id)).permissions).toEqual(['users:read']);
    });

    it('refuses to assign a role holding a permission the assigner lacks', async () => {
      const admin = await userWithRole('admin');
      const managerRole = await createRole(admin, ['users:read', 'users:write', 'channels:read']);
      const { rows } = await pool.query<{ name: string }>('SELECT name FROM roles WHERE id = $1', [managerRole]);
      const manager = await userWithRole(rows[0]!.name);
      const target = await userWithRole('channel-viewer');
      const refused = await UserService.updateUser(target, { role: 'deployer' }, manager);
      expect(!refused.ok && codeOf(refused.error)).toBe('FORBIDDEN');
    });
  });

  describe('more refusals', () => {
    it('refuses a name another role holds in any case', async () => {
      const admin = await userWithRole('admin');
      const id = await createRole(admin, []);
      await expect(db.transaction((tx) => GrantService.createRole(tx, { name: 'Viewer', description: '', permissions: [] }, { userId: admin })))
        .rejects.toSatisfy((e) => codeOf(e) === 'ALREADY_EXISTS');
      await expect(db.transaction((tx) => GrantService.updateRole(tx, id, { name: 'DEPLOYER' }, { userId: admin })))
        .rejects.toSatisfy((e) => codeOf(e) === 'ALREADY_EXISTS');
    });

    it('refuses to delete a role only an expired assignment still references', async () => {
      const admin = await userWithRole('admin');
      const id = await createRole(admin, []);
      const holder = await userWithRole('viewer');
      await pool.query(`INSERT INTO assignments (user_id, role_id, expires_at) VALUES ($1, $2, now() - interval '1 day')`, [holder, id]);
      await expect(db.transaction((tx) => GrantService.deleteRole(tx, id, { userId: admin })))
        .rejects.toSatisfy((e) => codeOf(e) === 'CONFLICT');
    });

    it('refuses a disabled actor', async () => {
      const admin = await userWithRole('admin');
      await pool.query('UPDATE users SET enabled = false WHERE id = $1', [admin]);
      await expect(db.transaction((tx) => GrantService.createRole(tx, { name: tag(), description: '', permissions: ['channels:read'] }, { userId: admin })))
        .rejects.toSatisfy((e) => codeOf(e) === 'FORBIDDEN');
    });

    it('refuses to create a user with a role wider than the creator holds', async () => {
      const admin = await userWithRole('admin');
      const managerRole = await createRole(admin, ['users:read', 'users:write', 'channels:read']);
      const { rows } = await pool.query<{ name: string }>('SELECT name FROM roles WHERE id = $1', [managerRole]);
      const manager = await userWithRole(rows[0]!.name);
      const name = tag();
      const result = await UserService.createUser({ username: name, email: `${name}@example.test`, password: 'password123', role: 'deployer' }, { userId: manager, ipAddress: null });
      expect(!result.ok && codeOf(result.error)).toBe('FORBIDDEN');
      const { rowCount } = await pool.query('SELECT 1 FROM users WHERE username = $1', [name]);
      expect(rowCount).toBe(0);
    });

    it('refuses an edit to a role held by a user the editor could not manage (the target rule)', async () => {
      const admin = await userWithRole('admin');
      const channelViewer = (await GrantService.listRoles()).find((r) => r.name === 'channel-viewer')!;
      const editorRole = await createRole(admin, [...channelViewer.permissions, 'roles:read', 'roles:write']);
      const { rows } = await pool.query<{ name: string }>('SELECT name FROM roles WHERE id = $1', [editorRole]);
      const editor = await userWithRole(rows[0]!.name);
      const wideRole = await createRole(admin, ['channels:read', 'channels:deploy']);
      const wide = await pool.query<{ name: string }>('SELECT name FROM roles WHERE id = $1', [wideRole]);
      await userWithRole(wide.rows[0]!.name);

      // Emptying the role would cut off a holder the editor could not edit one by one.
      await expect(db.transaction((tx) => GrantService.updateRole(tx, wideRole, { permissions: [] }, { userId: editor })))
        .rejects.toSatisfy((e) => codeOf(e) === 'FORBIDDEN');
      const narrowRole = await createRole(admin, ['channels:read']);
      await db.transaction((tx) => GrantService.updateRole(tx, narrowRole, { permissions: [] }, { userId: editor }));
    });
  });

  describe('over HTTP', () => {
    let server: import('node:http').Server;
    let base: string;

    beforeAll(async () => {
      process.env['API_RATE_LIMIT_MAX'] = '1000000';
      const app = (await import('../../src/app.js')).default;
      await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
      base = `http://127.0.0.1:${String((server.address() as import('node:net').AddressInfo).port)}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
    });

    async function tokenFor(userId: string): Promise<string> {
      const { signAccessToken } = await import('../../src/lib/jwt.js');
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, now() + interval '1 hour') RETURNING id`, [userId, `itest-${randomUUID()}`],
      );
      return signAccessToken({ userId, sessionId: rows[0]!.id });
    }

    async function call(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: { data?: { id?: string }; error?: { code?: string; details?: { assignments?: unknown } } } }> {
      const res = await fetch(`${base}/api/v1${path}`, {
        method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, json: res.status === 204 ? {} : await res.json() as never };
    }

    it('creates (201), refuses an admin flag (400), and names holders only to a caller who may read users', async () => {
      const admin = await userWithRole('admin');
      const adminToken = await tokenFor(admin);
      expect((await call(adminToken, 'POST', '/roles', { name: tag(), permissions: [], admin: true })).status).toBe(400);

      const created = await call(adminToken, 'POST', '/roles', { name: tag(), permissions: ['channels:read'] });
      expect(created.status).toBe(201);
      const roleId = created.json.data!.id!;
      createdRoles.push(roleId);
      const { rows } = await pool.query<{ name: string }>('SELECT name FROM roles WHERE id = $1', [roleId]);
      await userWithRole(rows[0]!.name);

      const asAdmin = await call(adminToken, 'DELETE', `/roles/${roleId}`);
      expect(asAdmin.status).toBe(409);
      expect(Array.isArray(asAdmin.json.error?.details?.assignments)).toBe(true);

      const editorRole = await createRole(admin, ['channels:read', 'roles:read', 'roles:write']);
      const editorName = await pool.query<{ name: string }>('SELECT name FROM roles WHERE id = $1', [editorRole]);
      const editor = await userWithRole(editorName.rows[0]!.name);
      const asEditor = await call(await tokenFor(editor), 'DELETE', `/roles/${roleId}`);
      expect(asEditor.status).toBe(409);
      expect(asEditor.json.error?.details?.assignments).toBe(1);
    });

    it('refuses the role routes to a caller without the role permissions (403)', async () => {
      const viewer = await userWithRole('viewer');
      const token = await tokenFor(viewer);
      expect((await call(token, 'GET', '/roles')).status).toBe(403);
      expect((await call(token, 'POST', '/roles', { name: tag(), permissions: [] })).status).toBe(403);
    });

    it('edits a role (200) and answers with the saved role', async () => {
      const admin = await userWithRole('admin');
      const token = await tokenFor(admin);
      const roleId = await createRole(admin, ['channels:read']);

      const edited = await call(token, 'PUT', `/roles/${roleId}`, { permissions: ['messages:read'] });

      expect(edited.status).toBe(200);
      expect(edited.json.data).toMatchObject({ id: roleId, permissions: ['messages:read'] });
      expect((await GrantService.getRole(roleId)).permissions).toEqual(['messages:read']);
    });

    it('refuses to edit or delete the admin role (403 SYSTEM_PROTECTED)', async () => {
      const token = await tokenFor(await userWithRole('admin'));
      const adminRole = (await GrantService.listRoles()).find((r) => r.admin)!;

      for (const [method, body] of [['PUT', { name: 'root' }], ['DELETE', undefined]] as const) {
        const refused = await call(token, method, `/roles/${adminRole.id}`, body);
        expect(refused.status).toBe(403);
        expect(refused.json.error?.code).toBe('SYSTEM_PROTECTED');
      }
    });

    it('deletes an unassigned role (204)', async () => {
      const admin = await userWithRole('admin');
      const roleId = await createRole(admin, []);
      expect((await call(await tokenFor(admin), 'DELETE', `/roles/${roleId}`)).status).toBe(204);
    });
  });

  describe('the target rule', () => {
    it('lets a user manager act only on users whose access is within their own', async () => {
      const admin = await userWithRole('admin');
      const channelViewer = (await GrantService.listRoles()).find((r) => r.name === 'channel-viewer')!;
      const managerRole = await createRole(admin, [...channelViewer.permissions, 'users:read', 'users:write', 'users:delete']);
      const { rows } = await pool.query<{ name: string }>('SELECT name FROM roles WHERE id = $1', [managerRole]);
      const manager = await userWithRole(rows[0]!.name);
      const within = await userWithRole('channel-viewer');
      const wider = await userWithRole('deployer');

      expect((await UserService.updateUser(within, { firstName: 'Ok' }, manager)).ok).toBe(true);
      expect((await UserService.unlockUser(within, manager)).ok).toBe(true);

      for (const result of [
        await UserService.updateUser(wider, { firstName: 'No' }, manager),
        await UserService.deleteUser(wider, manager),
        await UserService.changePassword(wider, 'password123', manager, true),
        await UserService.unlockUser(wider, manager),
      ]) {
        expect(!result.ok && codeOf(result.error)).toBe('FORBIDDEN');
      }
    });
  });
});
