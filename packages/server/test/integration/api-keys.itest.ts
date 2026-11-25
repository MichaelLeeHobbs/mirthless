// A key is its own principal (D-313).

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { ApiKeyView, ChannelAccessView, IssuedApiKey } from '@galvanigraph/core-models';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiCall, closeServer, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, listen, loadServerModules, userWithRole,
  type ServerModules, type TestUser,
} from './_setup.js';

describeIntegration('API keys (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const roles: string[] = [];
  let lab: string;
  let rad: string;
  const LAB_CHANNEL = randomUUID();
  const RAD_CHANNEL = randomUUID();
  let admin: TestUser;

  async function user(role: string | null, groupIds: readonly string[] | null): Promise<TestUser> {
    const made = await userWithRole(mods.pool, role, groupIds);
    users.push(made.id);
    return made;
  }

  async function roleOf(permissions: readonly string[]): Promise<{ readonly id: string; readonly name: string }> {
    const name = `itest-keys-${randomUUID().slice(0, 8)}`;
    const role = await mods.pool.query<{ id: string }>('INSERT INTO roles (name) VALUES ($1) RETURNING id', [name]);
    const id = role.rows[0]!.id;
    roles.push(id);
    for (const p of permissions) await mods.pool.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [id, p]);
    return { id, name };
  }

  async function holderOf(permissions: readonly string[], until?: Date): Promise<TestUser> {
    const holder = await user((await roleOf(permissions)).name, null);
    if (until) await mods.pool.query('UPDATE assignments SET expires_at = $2 WHERE user_id = $1', [holder.id, until]);
    return holder;
  }

  const inDays = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

  async function issue(as: TestUser, body: Record<string, unknown>): Promise<{ status: number; data?: IssuedApiKey; message?: string }> {
    const res = await apiCall<IssuedApiKey>(base, as.token, 'POST', '/api-keys', body);
    return { status: res.status, ...(res.json.data ? { data: res.json.data } : {}), ...(res.json.error?.message ? { message: res.json.error.message } : {}) };
  }

  async function raw(path: string, init: RequestInit): Promise<{ status: number; body: string }> {
    const res = await fetch(`${base}/api/v1${path}`, init);
    return { status: res.status, body: await res.text() };
  }

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    process.env['API_KEY_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    lab = await insertTestGroup(mods.pool);
    rad = await insertTestGroup(mods.pool);
    await insertTestChannel(mods, LAB_CHANNEL);
    await insertTestChannel(mods, RAD_CHANNEL);
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2), ($3, $4)', [lab, LAB_CHANNEL, rad, RAD_CHANNEL]);
    admin = await user('admin', null);
    const app = (await import('../../src/app.js')).default;
    ({ server, base } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
    // Keys first: their issuer is one of these users. A key's user cascades its key and assignment.
    await mods.pool.query(`DELETE FROM users WHERE id IN (SELECT user_id FROM api_keys WHERE issued_by = ANY($1::uuid[]))`, [users]);
    await mods.pool.query(`DELETE FROM roles WHERE key_role AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.role_id = roles.id)`);
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    if (roles.length > 0) await mods.pool.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [roles]);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = ANY($1::uuid[])', [[LAB_CHANNEL, RAD_CHANNEL]]);
    await deleteTestChannel(mods, LAB_CHANNEL);
    await deleteTestChannel(mods, RAD_CHANNEL);
    await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [[lab, rad]]);
    await mods.pool.end();
  });

  describe('issuing and signing in', () => {
    let issued: IssuedApiKey;

    beforeAll(async () => {
      const res = await issue(admin, { name: 'Lab feed', permissions: ['channels:read', 'channels:deploy'], groupIds: [lab], expiresAt: inDays(30) });
      expect(res.status).toBe(201);
      issued = res.data!;
    });

    it('answers the token once, and the key without it ever after', async () => {
      expect(issued.token).toMatch(new RegExp(`^gf_${issued.key.id}_[A-Za-z0-9_-]{43}$`));
      expect(issued.key).toMatchObject({ name: 'Lab feed', permissions: ['channels:deploy', 'channels:read'], groupIds: [lab], status: 'active', issuedBy: { id: admin.id } });
      const read = await apiCall<ApiKeyView>(base, admin.token, 'GET', `/api-keys/${issued.key.id}`);
      expect(JSON.stringify(read.json)).not.toContain(issued.token.slice(-43));
      const stored = await mods.pool.query<{ secret_hash: string }>('SELECT secret_hash FROM api_keys WHERE id = $1', [issued.key.id]);
      expect(stored.rows[0]!.secret_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.rows[0]!.secret_hash).not.toContain(issued.token.slice(-43));
    });

    it('acts within its scope and nowhere else', async () => {
      expect((await apiCall(base, issued.token, 'GET', `/channels/${LAB_CHANNEL}`)).status).toBe(200);
      expect((await apiCall(base, issued.token, 'GET', `/channels/${RAD_CHANNEL}`)).status).toBe(404);
      expect((await apiCall(base, issued.token, 'GET', '/users')).status).toBe(403);
      expect((await apiCall(base, issued.token, 'GET', '/api-keys')).status).toBe(403);
    });

    it('notes its last use', async () => {
      await expect.poll(async () => (await mods.pool.query('SELECT last_used_at FROM api_keys WHERE id = $1', [issued.key.id])).rows[0]?.last_used_at ?? null)
        .not.toBeNull();
    });

    it('refuses a wrong secret, an unknown key, a malformed one, or a key in the URL, all with one answer', async () => {
      const wrongSecret = `${issued.token.slice(0, -1)}${issued.token.endsWith('A') ? 'B' : 'A'}`;
      const answers = [
        await raw(`/channels/${LAB_CHANNEL}`, { headers: { authorization: `Bearer ${wrongSecret}` } }),
        await raw(`/channels/${LAB_CHANNEL}`, { headers: { authorization: `Bearer gf_${randomUUID()}_${'A'.repeat(43)}` } }),
        await raw(`/channels/${LAB_CHANNEL}`, { headers: { authorization: 'Bearer gf_nonsense' } }),
        await raw(`/channels/${LAB_CHANNEL}?api_key=${encodeURIComponent(issued.token)}`, { headers: { authorization: `Bearer ${issued.token}` } }),
        await raw(`/channels/${LAB_CHANNEL}?api_key=${issued.token}`, { headers: { authorization: `Bearer ${issued.token}` } }),
      ];
      for (const a of answers) expect(a.status).toBe(401);
      expect(new Set(answers.map((a) => a.body)).size).toBe(1);
      expect((await raw(`/channels/${LAB_CHANNEL}?k=${encodeURIComponent(issued.token)}`, { headers: { authorization: `Bearer ${admin.token}` } })).status).toBe(401);
    });

    it('shows in the access view by its name', async () => {
      const view = (await apiCall<ChannelAccessView>(base, admin.token, 'GET', `/channels/${LAB_CHANNEL}/access`)).json.data!;
      const key = view.people.find((p) => p.username === 'API key: Lab feed');
      expect(key?.through).toMatchObject([{ role: 'API key', groupIds: [lab] }]);
    });

    it('is never a person: not listed, not signed in, not managed, its role never offered', async () => {
      const keyUser = (await mods.pool.query<{ user_id: string }>('SELECT user_id FROM api_keys WHERE id = $1', [issued.key.id])).rows[0]!.user_id;
      const listed = await apiCall<Array<{ id: string }>>(base, admin.token, 'GET', '/users');
      expect(listed.json.data!.some((u) => u.id === keyUser)).toBe(false);
      expect((await apiCall(base, admin.token, 'GET', `/users/${keyUser}`)).status).toBe(404);
      expect((await apiCall(base, admin.token, 'PUT', `/users/${keyUser}/assignments`, { assignments: [] })).status).toBe(404);
      expect((await apiCall(base, admin.token, 'PUT', `/users/${keyUser}`, { enabled: false })).status).toBe(404);
      const login = await fetch(`${base}/api/v1/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: `api-key:${issued.key.id}`, password: '!' }),
      });
      expect(login.status).toBe(401);
      const listedRoles = await apiCall<Array<{ name: string }>>(base, admin.token, 'GET', '/roles');
      expect(listedRoles.json.data!.some((r) => r.name.startsWith('api-key:'))).toBe(false);
      const keyRole = (await mods.pool.query<{ id: string }>('SELECT role_id AS id FROM assignments WHERE user_id = $1', [keyUser])).rows[0]!.id;
      expect((await apiCall(base, admin.token, 'GET', `/roles/${keyRole}`)).status).toBe(404);
      expect((await apiCall(base, admin.token, 'PUT', `/roles/${keyRole}`, { permissions: ['channels:read'] })).status).toBe(404);
      const target = await user(null, null);
      expect((await apiCall(base, admin.token, 'PUT', `/users/${target.id}/assignments`, { assignments: [{ roleId: keyRole, groupIds: null }] })).status).toBe(404);
    });
  });

  describe('lifecycle', () => {
    it('stops working when disabled, works again when enabled, and never again once revoked', async () => {
      const { data } = await issue(admin, { name: 'Life', permissions: ['channels:read'], groupIds: null, expiresAt: inDays(1) });
      const id = data!.key.id;
      const works = async (): Promise<number> => (await apiCall(base, data!.token, 'GET', `/channels/${LAB_CHANNEL}`)).status;
      expect(await works()).toBe(200);
      expect((await apiCall<ApiKeyView>(base, admin.token, 'PATCH', `/api-keys/${id}/enabled`, { enabled: false })).json.data!.status).toBe('disabled');
      expect(await works()).toBe(401);
      expect((await apiCall(base, admin.token, 'PATCH', `/api-keys/${id}/enabled`, { enabled: true })).status).toBe(200);
      expect(await works()).toBe(200);
      const revoked = await apiCall<ApiKeyView>(base, admin.token, 'POST', `/api-keys/${id}/revoke`, { reason: 'Leaked in a build log' });
      expect(revoked.json.data).toMatchObject({ status: 'revoked', revokeReason: 'Leaked in a build log' });
      expect(await works()).toBe(401);
      expect((await apiCall(base, admin.token, 'PATCH', `/api-keys/${id}/enabled`, { enabled: true })).status).toBe(409);
      expect((await apiCall(base, admin.token, 'POST', `/api-keys/${id}/revoke`, { reason: 'Again' })).status).toBe(409);
      const audit = await mods.pool.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE attributes->>'apiKeyId' = $1 ORDER BY id`, [id],
      );
      expect(audit.rows.map((r) => r.action)).toEqual(['ROLE_CREATED', 'API_KEY_ISSUED', 'API_KEY_REVOKED']);
      // The rows the access replay reads for the key's principal: its assignment, then disable, enable and revoke.
      const keyUser = (await mods.pool.query<{ user_id: string }>('SELECT user_id FROM api_keys WHERE id = $1', [id])).rows[0]!.user_id;
      const grantRows = await mods.pool.query<{ action: string; enabled: string | null }>(
        `SELECT action, attributes->>'enabled' AS enabled FROM audit_log WHERE attributes->>'targetUserId' = $1 ORDER BY id`, [keyUser],
      );
      expect(grantRows.rows).toEqual([
        { action: 'ASSIGNMENTS_CHANGED', enabled: null },
        { action: 'USER_ENABLED_CHANGED', enabled: 'false' },
        { action: 'USER_ENABLED_CHANGED', enabled: 'true' },
        { action: 'USER_ENABLED_CHANGED', enabled: 'false' },
      ]);
    });

    it('stops working at its end time', async () => {
      const { data } = await issue(admin, { name: 'Short', permissions: ['channels:read'], groupIds: null, expiresAt: inDays(1) });
      await mods.pool.query(`UPDATE api_keys SET expires_at = now() - interval '1 second' WHERE id = $1`, [data!.key.id]);
      expect((await apiCall(base, data!.token, 'GET', `/channels/${LAB_CHANNEL}`)).status).toBe(401);
      expect((await apiCall<ApiKeyView>(base, admin.token, 'GET', `/api-keys/${data!.key.id}`)).json.data!.status).toBe('expired');
      // Ended is for good: it cannot be switched back on.
      expect((await apiCall(base, admin.token, 'PATCH', `/api-keys/${data!.key.id}/enabled`, { enabled: false })).status).toBe(200);
      expect((await apiCall(base, admin.token, 'PATCH', `/api-keys/${data!.key.id}/enabled`, { enabled: true })).status).toBe(409);
    });

    it('stops working the moment its issuer is disabled or loses what the key holds', async () => {
      const issuer = await holderOf(['api_keys:manage', 'channels:read', 'channels:deploy']);
      const { data } = await issue(issuer, { name: 'Follows issuer', permissions: ['channels:read', 'channels:deploy'], groupIds: null, expiresAt: inDays(1) });
      const works = async (): Promise<number> => (await apiCall(base, data!.token, 'GET', `/channels/${LAB_CHANNEL}`)).status;
      expect(await works()).toBe(200);
      const role = (await mods.pool.query<{ role_id: string }>('SELECT role_id FROM assignments WHERE user_id = $1', [issuer.id])).rows[0]!.role_id;
      await mods.pool.query(`DELETE FROM role_permissions WHERE role_id = $1 AND permission = 'channels:deploy'`, [role]);
      expect(await works()).toBe(401);
      await mods.pool.query(`INSERT INTO role_permissions (role_id, permission) VALUES ($1, 'channels:deploy')`, [role]);
      expect(await works()).toBe(200);
      await mods.pool.query('UPDATE users SET enabled = false WHERE id = $1', [issuer.id]);
      expect(await works()).toBe(401);
    });

    it('refuses an enable by someone who does not hold what the key holds', async () => {
      const { data } = await issue(admin, { name: 'Deploy key', permissions: ['channels:deploy'], groupIds: null, expiresAt: inDays(1) });
      expect((await apiCall(base, admin.token, 'PATCH', `/api-keys/${data!.key.id}/enabled`, { enabled: false })).status).toBe(200);
      const manager = await holderOf(['api_keys:manage', 'channels:read']);
      expect((await apiCall(base, manager.token, 'PATCH', `/api-keys/${data!.key.id}/enabled`, { enabled: true })).status).toBe(403);
      // Anyone who manages keys may switch one off, or revoke it.
      expect((await apiCall(base, manager.token, 'POST', `/api-keys/${data!.key.id}/revoke`, { reason: 'Owner left' })).status).toBe(200);
    });

    it('shows in the access view as of a past time', async () => {
      // Test setup writes roles and assignments directly, unrecorded, as the seed does;
      // a baseline after them is where the replay starts.
      await mods.pool.query(`SELECT public.record_grant_baseline('api-keys itest')`);
      const { data } = await issue(admin, { name: 'Replayed', permissions: ['channels:read'], groupIds: [lab], expiresAt: inDays(1) });
      const { rows } = await mods.pool.query<{ t: Date }>('SELECT clock_timestamp() AS t');
      const at = rows[0]!.t.toISOString();
      const view = (await apiCall<ChannelAccessView>(base, admin.token, 'GET', `/channels/${LAB_CHANNEL}/access?asOf=${encodeURIComponent(at)}`)).json.data!;
      expect(view.people.find((p) => p.username === 'API key: Replayed')?.through).toMatchObject([{ role: 'API key', groupIds: [lab] }]);
      expect(data).toBeDefined();
    });
  });

  describe('the cap: within the issuer, now and until the key ends', () => {
    it('refuses permissions the issuer does not hold', async () => {
      const manager = await holderOf(['api_keys:manage', 'channels:read']);
      expect((await issue(manager, { name: 'Over', permissions: ['channels:write'], groupIds: [lab], expiresAt: inDays(1) })).status).toBe(403);
      expect((await issue(manager, { name: 'Ok', permissions: ['channels:read'], groupIds: [lab], expiresAt: inDays(1) })).status).toBe(201);
    });

    it('refuses a scope the issuer does not hold the permissions over', async () => {
      const reader = await roleOf(['channels:read']);
      const manager = await holderOf(['api_keys:manage']);
      const { rows } = await mods.pool.query<{ id: string }>('INSERT INTO assignments (user_id, role_id, all_channels) VALUES ($1, $2, false) RETURNING id', [manager.id, reader.id]);
      await mods.pool.query('INSERT INTO assignment_groups (assignment_id, channel_group_id) VALUES ($1, $2)', [rows[0]!.id, lab]);
      const over = (groupIds: readonly string[] | null): ReturnType<typeof issue> => issue(manager, { name: 'Scope', permissions: ['channels:read'], groupIds, expiresAt: inDays(1) });

      for (const groupIds of [[rad], [lab, rad], null]) {
        const refused = await over(groupIds);
        expect(refused.status).toBe(403);
        expect(refused.message).toMatch(/Missing: channels:read/);
      }
      expect((await over([lab])).status).toBe(201);
    });

    it('refuses a key that would outlast the issuer\'s own access', async () => {
      const temporary = await holderOf(['api_keys:manage', 'channels:read'], new Date(Date.now() + 3_600_000));
      const tooLong = await issue(temporary, { name: 'Long', permissions: ['channels:read'], groupIds: null, expiresAt: inDays(1) });
      expect(tooLong.status).toBe(403);
      expect(tooLong.message).toMatch(/outlast/);
      expect((await issue(temporary, { name: 'Brief', permissions: ['channels:read'], groupIds: null, expiresAt: new Date(Date.now() + 1_800_000).toISOString() })).status).toBe(201);
    });

    it('refuses identity permissions, a past end, and every-channel messages without a reason', async () => {
      expect((await issue(admin, { name: 'Id', permissions: ['users:read'], groupIds: null, expiresAt: inDays(1) })).status).toBe(400);
      expect((await issue(admin, { name: 'Past', permissions: ['channels:read'], groupIds: null, expiresAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
      expect((await issue(admin, { name: 'Wide', permissions: ['messages:read'], groupIds: null, expiresAt: inDays(1) })).status).toBe(400);
      const wide = await issue(admin, { name: 'Wide', permissions: ['messages:read'], groupIds: null, expiresAt: inDays(1), reason: 'Nightly extract' });
      expect(wide.status).toBe(201);
      expect(wide.data!.key.reason).toBe('Nightly extract');
      expect((await issue(admin, { name: 'Scoped', permissions: ['messages:read'], groupIds: [lab], expiresAt: inDays(1) })).status).toBe(201);
    });

    it('lets only api_keys:manage holders issue, and api_keys:read holders list', async () => {
      const reader = await holderOf(['api_keys:read']);
      expect((await apiCall(base, reader.token, 'GET', '/api-keys')).status).toBe(200);
      expect((await issue(reader, { name: 'No', permissions: ['channels:read'], groupIds: null, expiresAt: inDays(1) })).status).toBe(403);
    });
  });
});
