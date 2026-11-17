// ===========================================
// API keys: narrowing, Replace and offboarding (real Postgres, #267 slice 12c)
// ===========================================
// A key follows its issuer (D-313): narrowing the issuer disables the key in
// the same transaction; a leaver's keys are disabled, or kept for 7 days for
// someone to replace; Replace gives a new secret and a new issuer.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ApiKeyView, IssuedApiKey } from '@galvanigraph/core-models';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiCall, deleteTestChannel, describeIntegration, insertTestChannel, loadServerModules, userWithRole,
  type ServerModules, type TestUser,
} from './_setup.js';

describeIntegration('API keys: narrowing, Replace and offboarding (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const roles: string[] = [];
  const CHANNEL = randomUUID();
  let admin: TestUser;

  async function holderOf(permissions: readonly string[]): Promise<{ user: TestUser; roleId: string }> {
    const name = `itest-life-${randomUUID().slice(0, 8)}`;
    const role = await mods.pool.query<{ id: string }>('INSERT INTO roles (name) VALUES ($1) RETURNING id', [name]);
    const roleId = role.rows[0]!.id;
    roles.push(roleId);
    for (const p of permissions) await mods.pool.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [roleId, p]);
    const user = await userWithRole(mods.pool, name, null);
    users.push(user.id);
    return { user, roleId };
  }

  async function issue(as: TestUser, permissions: readonly string[]): Promise<IssuedApiKey> {
    const res = await apiCall<IssuedApiKey>(base, as.token, 'POST', '/api-keys', {
      name: `k-${randomUUID().slice(0, 6)}`, permissions, groupIds: null, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(res.status).toBe(201);
    return res.json.data!;
  }

  const works = async (token: string): Promise<number> => (await apiCall(base, token, 'GET', `/channels/${CHANNEL}`)).status;
  const view = async (id: string): Promise<ApiKeyView> => (await apiCall<ApiKeyView>(base, admin.token, 'GET', `/api-keys/${id}`)).json.data!;
  const MANAGER = ['api_keys:manage', 'channels:read', 'channels:deploy'];

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    process.env['API_KEY_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    await insertTestChannel(mods, CHANNEL);
    admin = await userWithRole(mods.pool, 'admin', null);
    users.push(admin.id);
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    await mods.pool.query(`DELETE FROM users WHERE id IN (SELECT user_id FROM api_keys WHERE issued_by = ANY($1::uuid[]))`, [users]);
    await mods.pool.query(`DELETE FROM roles WHERE key_role AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.role_id = roles.id)`);
    await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    if (roles.length > 0) await mods.pool.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [roles]);
    await deleteTestChannel(mods, CHANNEL);
    await mods.pool.end();
  });

  describe('narrowing the issuer', () => {
    it('disables the key in the same change when the issuer\'s role loses what the key holds', async () => {
      const { user, roleId } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read', 'channels:deploy']);
      const other = await issue(user, ['channels:read']);
      expect((await apiCall(base, admin.token, 'PUT', `/roles/${roleId}`, { permissions: ['api_keys:manage', 'channels:read'] })).status).toBe(200);
      expect((await view(key.key.id)).status).toBe('disabled');
      // A key still within the issuer's access is left alone.
      expect((await view(other.key.id)).status).toBe('active');
      const why = await mods.pool.query<{ why: string }>(
        `SELECT attributes->>'why' AS why FROM audit_log WHERE action = 'USER_ENABLED_CHANGED' AND attributes->>'targetUserId' = (SELECT user_id::text FROM api_keys WHERE id = $1)`, [key.key.id],
      );
      expect(why.rows.map((r) => r.why)).toEqual(['issuer no longer holds what the key holds']);
    });

    it('disables a key that would outlast the issuer\'s shortened access', async () => {
      const { user, roleId } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read']);
      const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
      expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}/assignments`, { assignments: [{ roleId, groupIds: null, expiresAt: nextWeek }] })).status).toBe(200);
      expect((await view(key.key.id)).status).toBe('disabled');
    });

    it('disables the key when the issuer\'s role is changed with PUT /users/:id', async () => {
      const { user } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read', 'channels:deploy']);
      expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}`, { role: 'viewer' })).status).toBe(200);
      expect((await view(key.key.id)).status).toBe('disabled');
    });

    it('disables the key when the issuer\'s assignments are taken away', async () => {
      const { user } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read']);
      expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}/assignments`, { assignments: [] })).status).toBe(200);
      expect((await view(key.key.id)).status).toBe('disabled');
      expect(await works(key.token)).toBe(401);
    });
  });

  describe('offboarding', () => {
    it('disables a deleted user\'s keys when the request says nothing', async () => {
      const { user } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read']);
      expect((await apiCall(base, admin.token, 'DELETE', `/users/${user.id}`)).status).toBeLessThan(300);
      expect((await view(key.key.id)).status).toBe('disabled');
    });

    it('lets only a key manager keep a leaver\'s keys running', async () => {
      const { user } = await holderOf(MANAGER);
      const { user: usersOnly } = await holderOf(['users:read', 'users:write', 'users:delete', 'channels:read', 'channels:deploy', 'api_keys:read']);
      await issue(user, ['channels:read']);
      expect((await apiCall(base, usersOnly.token, 'PUT', `/users/${user.id}`, { enabled: false, issuedKeys: 'replace_within_7_days' })).status).toBe(403);
      expect((await apiCall(base, usersOnly.token, 'DELETE', `/users/${user.id}?issuedKeys=replace_within_7_days`)).status).toBe(403);
    });

    it('disables, and records, a leaver\'s key that their narrowing leaves uncovered during the window', async () => {
      const { user } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read']);
      expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}`, { enabled: false, issuedKeys: 'replace_within_7_days' })).status).toBe(200);
      expect(await works(key.token)).toBe(200);
      expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}/assignments`, { assignments: [] })).status).toBe(200);
      expect((await view(key.key.id)).status).toBe('disabled');
      expect(await works(key.token)).toBe(401);
    });

    it('gives a leaver\'s keys back to them, with no deadline, when they are enabled again', async () => {
      const { user } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read']);
      expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}`, { enabled: false, issuedKeys: 'replace_within_7_days' })).status).toBe(200);
      expect((await view(key.key.id)).replaceBy).not.toBeNull();
      expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}`, { enabled: true })).status).toBe(200);
      expect(await view(key.key.id)).toMatchObject({ status: 'active', replaceBy: null });
      expect(await works(key.token)).toBe(200);
    });

    it('disables a leaver\'s keys by default, and records it', async () => {
      const { user } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read']);
      expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}`, { enabled: false })).status).toBe(200);
      expect((await view(key.key.id)).status).toBe('disabled');
      const row = await mods.pool.query<{ mode: string; ids: string[] }>(
        `SELECT attributes->>'mode' AS mode, ARRAY(SELECT jsonb_array_elements_text(attributes->'apiKeyIds')) AS ids FROM audit_log WHERE action = 'API_KEYS_OFFBOARDED' AND attributes->>'issuerId' = $1`, [user.id],
      );
      expect(row.rows).toEqual([{ mode: 'disable', ids: [key.key.id] }]);
    });

    it('keeps a leaver\'s keys working for 7 days when asked, until someone replaces them, ending the old secret at once', async () => {
      const { user } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read']);
      expect((await apiCall(base, admin.token, 'DELETE', `/users/${user.id}?issuedKeys=replace_within_7_days`)).status).toBeLessThan(300);
      expect(await works(key.token)).toBe(200);
      const waiting = await view(key.key.id);
      expect(waiting.status).toBe('active');
      expect(Date.parse(waiting.replaceBy!) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

      // Asked for a planned change, a replace during offboarding still ends the old secret now.
      const replaced = await apiCall<IssuedApiKey>(base, admin.token, 'POST', `/api-keys/${key.key.id}/replace`, { mode: 'planned' });
      expect(replaced.status).toBe(201);
      expect(replaced.json.data!.key).toMatchObject({ issuedBy: { id: admin.id }, replaceBy: null, previousSecretUntil: null });
      expect(await works(key.token)).toBe(401);
      expect(await works(replaced.json.data!.token)).toBe(200);
    });

    it('disables a leaver\'s key nobody replaced once the window has passed, and warns before', async () => {
      const { user } = await holderOf(MANAGER);
      const soon = await issue(user, ['channels:read']);
      const lapsed = await issue(user, ['channels:read']);
      expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}`, { enabled: false, issuedKeys: 'replace_within_7_days' })).status).toBe(200);
      await mods.pool.query(`UPDATE api_keys SET replace_by = now() + interval '1 day' WHERE id = $1`, [soon.key.id]);
      await mods.pool.query(`UPDATE api_keys SET replace_by = now() - interval '1 second' WHERE id = $1`, [lapsed.key.id]);
      // Past its window the key stops at once, before the daily run catches up.
      expect(await works(lapsed.token)).toBe(401);
      expect(await works(soon.token)).toBe(200);

      const { ApiKeyService } = await import('../../src/services/api-key.service.js');
      await ApiKeyService.enforceReplacementDeadlines();
      expect((await view(lapsed.key.id)).status).toBe('disabled');
      expect((await view(soon.key.id)).status).toBe('active');
      const warnings = async (): Promise<number> => (await mods.pool.query(
        `SELECT 1 FROM events WHERE name = 'API_KEY_REPLACEMENT_DUE' AND attributes->>'apiKeyId' = $1`, [soon.key.id],
      )).rowCount ?? 0;
      expect(await warnings()).toBe(1);
      // Warned once.
      await ApiKeyService.enforceReplacementDeadlines();
      expect(await warnings()).toBe(1);
    });
  });

  describe('replace', () => {
    it('keeps the old secret working for a planned change, and ends it at once for a leak', async () => {
      const planned = await issue(admin, ['channels:read']);
      const next = await apiCall<IssuedApiKey>(base, admin.token, 'POST', `/api-keys/${planned.key.id}/replace`, { mode: 'planned' });
      expect(next.status).toBe(201);
      expect(Date.parse(next.json.data!.key.previousSecretUntil!) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
      expect(await works(planned.token)).toBe(200);
      expect(await works(next.json.data!.token)).toBe(200);

      const leak = await apiCall<IssuedApiKey>(base, admin.token, 'POST', `/api-keys/${planned.key.id}/replace`, { mode: 'leak' });
      expect(await works(planned.token)).toBe(401);
      expect(await works(next.json.data!.token)).toBe(401);
      expect(await works(leak.json.data!.token)).toBe(200);
      const recorded = await mods.pool.query<{ mode: string }>(
        `SELECT attributes->>'mode' AS mode FROM audit_log WHERE action = 'API_KEY_REPLACED' AND attributes->>'apiKeyId' = $1 ORDER BY id`, [planned.key.id],
      );
      expect(recorded.rows.map((r) => r.mode)).toEqual(['planned', 'leak']);
    });

    it('makes the replacer the issuer, so the old issuer\'s narrowing no longer touches the key', async () => {
      const { user: first, roleId } = await holderOf(MANAGER);
      const { user: second } = await holderOf(MANAGER);
      const key = await issue(first, ['channels:read', 'channels:deploy']);
      const next = await apiCall<IssuedApiKey>(base, second.token, 'POST', `/api-keys/${key.key.id}/replace`, { mode: 'leak' });
      expect(next.json.data!.key.issuedBy.id).toBe(second.id);
      // Each holder has a role of their own: narrowing the first issuer's no longer reaches the key.
      expect((await apiCall(base, admin.token, 'PUT', `/roles/${roleId}`, { permissions: ['api_keys:manage'] })).status).toBe(200);
      expect((await view(key.key.id)).status).toBe('active');
      expect(await works(next.json.data!.token)).toBe(200);
    });

    it('needs the replacer to hold what the key holds', async () => {
      const key = await issue(admin, ['channels:read', 'channels:deploy']);
      const { user } = await holderOf(['api_keys:manage', 'channels:read']);
      expect((await apiCall(base, user.token, 'POST', `/api-keys/${key.key.id}/replace`, { mode: 'leak' })).status).toBe(403);
      expect(await works(key.token)).toBe(200);
    });
  });
});
