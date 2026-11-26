// A key follows its issuer (D-313).

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { ApiKeyView, IssuedApiKey } from '@galvanigraph/core-models';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiCall, closeServer, deleteTestChannel, describeIntegration, insertTestChannel, issueKey, listen, loadServerModules, userWithRole,
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

  const issue = (as: TestUser, permissions: readonly string[]): Promise<IssuedApiKey> => issueKey(base, as, permissions);

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
    ({ server, base } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
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

    // Enabled, it was shown active and every request with it was a 401 (#450).
    it('will not switch the key back on while its issuer no longer holds what it holds: it must be replaced', async () => {
      const { user, roleId } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read', 'channels:deploy']);
      expect((await apiCall(base, admin.token, 'PUT', `/roles/${roleId}`, { permissions: ['api_keys:manage', 'channels:read'] })).status).toBe(200);

      const refused = await apiCall(base, admin.token, 'PATCH', `/api-keys/${key.key.id}/enabled`, { enabled: true });

      expect(refused.status).toBe(409);
      expect(refused.json.error).toEqual({ code: 'CONFLICT', message: 'Its issuer does not hold what the key holds until the key ends; replace the key to take it over' });
      expect((await view(key.key.id)).status).toBe('disabled');
      const next = await apiCall<IssuedApiKey>(base, admin.token, 'POST', `/api-keys/${key.key.id}/replace`, { mode: 'leak' });
      expect(next.status).toBe(201);
      expect((await apiCall(base, admin.token, 'PATCH', `/api-keys/${key.key.id}/enabled`, { enabled: true })).status).toBe(200);
      expect(await works(next.json.data!.token)).toBe(200);
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

  describe('an issuer whose access ended by itself', () => {
    const DAY_MS = 86_400_000;
    const at = (days: number): string => new Date(Date.now() + days * DAY_MS).toISOString();

    async function lapsed(): Promise<{ readonly key: IssuedApiKey; readonly giveBack: (until: string | null) => Promise<void> }> {
      const { user, roleId } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read']);
      await mods.pool.query(`UPDATE assignments SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [user.id]);
      expect(await works(key.token)).toBe(401);
      expect((await view(key.key.id)).status).toBe('active');
      return {
        key,
        giveBack: async (expiresAt) => {
          expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}/assignments`, { assignments: [{ roleId, groupIds: null, expiresAt }] })).status).toBe(200);
        },
      };
    }

    it.each([['with no end', null], ['until after the key ends', at(365)]])('brings the key back when it is given back %s', async (_for, until) => {
      const { key, giveBack } = await lapsed();

      await giveBack(until);

      expect((await view(key.key.id)).status).toBe('active');
      expect(await works(key.token)).toBe(200);
    });

    it('disables the key when it is given back for less time than the key has left (#419)', async () => {
      const { key, giveBack } = await lapsed();

      await giveBack(at(1));

      expect((await view(key.key.id)).status).toBe('disabled');
      expect(await works(key.token)).toBe(401);
    });
  });

  describe('offboarding: a leaver\'s keys stop with them (D-322)', () => {
    const offboarded = async (issuerId: string): Promise<unknown[]> => (await mods.pool.query<{ a: unknown }>(
      `SELECT attributes AS a FROM audit_log WHERE action = 'API_KEYS_OFFBOARDED' AND attributes->>'issuerId' = $1`, [issuerId],
    )).rows.map((r) => r.a);

    it('disables every working key of a user who is disabled, in the same change, and records it', async () => {
      const { user } = await holderOf(MANAGER);
      const one = await issue(user, ['channels:read']);
      const two = await issue(user, ['channels:read', 'channels:deploy']);
      expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}`, { enabled: false })).status).toBe(200);
      expect((await view(one.key.id)).status).toBe('disabled');
      expect((await view(two.key.id)).status).toBe('disabled');
      expect(await works(one.token)).toBe(401);
      const [record, ...more] = await offboarded(user.id) as Array<{ disabledApiKeyIds: string[]; takenOverApiKeyIds: string[] }>;
      expect(more).toHaveLength(0);
      expect([...record!.disabledApiKeyIds].sort()).toEqual([one.key.id, two.key.id].sort());
      expect(record!.takenOverApiKeyIds).toEqual([]);
    });

    it('disables every working key of a user who is deleted', async () => {
      const { user } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read']);
      expect((await apiCall(base, admin.token, 'DELETE', `/users/${user.id}`)).status).toBe(204);
      expect((await view(key.key.id)).status).toBe('disabled');
      // Enabling the user again does not bring the keys back: they must be switched on, or replaced.
      expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}`, { enabled: true })).status).toBe(200);
      expect((await view(key.key.id)).status).toBe('disabled');
    });

    it('lets a key manager who covers a key take it over: a new token, the old one ended, the rest disabled', async () => {
      const { user } = await holderOf(MANAGER);
      const kept = await issue(user, ['channels:read']);
      const dropped = await issue(user, ['channels:read']);
      const res = await apiCall<{ takenOver: Array<{ keyId: string; name: string; token: string }> }>(
        base, admin.token, 'DELETE', `/users/${user.id}?takeOwnership=${kept.key.id}`,
      );
      expect(res.status).toBe(200);
      const taken = res.json.data!.takenOver;
      expect(taken).toMatchObject([{ keyId: kept.key.id, name: kept.key.name }]);
      expect(await works(kept.token)).toBe(401);
      expect(await works(taken[0]!.token)).toBe(200);
      expect(await view(kept.key.id)).toMatchObject({ status: 'active', issuedBy: { id: admin.id }, previousSecretUntil: null });
      expect((await view(dropped.key.id)).status).toBe('disabled');
      const replaced = await mods.pool.query<{ mode: string; from: string }>(
        `SELECT attributes->>'mode' AS mode, attributes->>'tookOwnershipFrom' AS from FROM audit_log WHERE action = 'API_KEY_REPLACED' AND attributes->>'apiKeyId' = $1`, [kept.key.id],
      );
      expect(replaced.rows).toEqual([{ mode: 'leak', from: user.id }]);
    });

    it('refuses the whole change when the taker does not cover the key until it ends, leaving the user and keys as they were', async () => {
      const { user } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read']);
      // Holds everything the leaver does, but only for the next hour; the key runs 30 days.
      const brief = await holderOf([...MANAGER, 'users:read', 'users:write', 'users:delete', 'api_keys:read']);
      await mods.pool.query(`UPDATE assignments SET expires_at = now() + interval '1 hour' WHERE user_id = $1`, [brief.user.id]);
      const res = await apiCall(base, brief.user.token, 'DELETE', `/users/${user.id}?takeOwnership=${key.key.id}`);
      expect(res.status).toBe(403);
      expect(res.json.error?.message).toMatch(/cannot outlast your own access/);
      expect(await works(key.token)).toBe(200);
      expect((await apiCall<{ enabled: boolean }>(base, admin.token, 'GET', `/users/${user.id}`)).json.data!.enabled).toBe(true);
    });

    it('refuses to take over a key the user did not issue', async () => {
      const { user } = await holderOf(MANAGER);
      const notTheirs = await issue(admin, ['channels:read']);
      expect((await apiCall(base, admin.token, 'DELETE', `/users/${user.id}?takeOwnership=${notTheirs.key.id}`)).status).toBe(400);
      expect((await view(notTheirs.key.id)).issuedBy.id).toBe(admin.id);
      expect((await apiCall<{ enabled: boolean }>(base, admin.token, 'GET', `/users/${user.id}`)).json.data!.enabled).toBe(true);
    });

    it('refuses to take over a revoked or already disabled key, changing nothing', async () => {
      const { user } = await holderOf(MANAGER);
      const revoked = await issue(user, ['channels:read']);
      await apiCall(base, admin.token, 'POST', `/api-keys/${revoked.key.id}/revoke`, { reason: 'Done with it' });
      expect((await apiCall(base, admin.token, 'DELETE', `/users/${user.id}?takeOwnership=${revoked.key.id}`)).status).toBe(409);
      const off = await issue(user, ['channels:read']);
      await apiCall(base, admin.token, 'PATCH', `/api-keys/${off.key.id}/enabled`, { enabled: false });
      expect((await apiCall(base, admin.token, 'DELETE', `/users/${user.id}?takeOwnership=${off.key.id}`)).status).toBe(409);
      expect((await apiCall<{ enabled: boolean }>(base, admin.token, 'GET', `/users/${user.id}`)).json.data!.enabled).toBe(true);
    });

    it('will not switch on a key whose issuer is disabled: it must be replaced', async () => {
      const { user } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read']);
      expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}`, { enabled: false })).status).toBe(200);
      expect((await apiCall(base, admin.token, 'PATCH', `/api-keys/${key.key.id}/enabled`, { enabled: true })).status).toBe(409);
      const next = await apiCall<IssuedApiKey>(base, admin.token, 'POST', `/api-keys/${key.key.id}/replace`, { mode: 'leak' });
      expect(next.status).toBe(201);
      expect((await apiCall(base, admin.token, 'PATCH', `/api-keys/${key.key.id}/enabled`, { enabled: true })).status).toBe(200);
      expect(await works(next.json.data!.token)).toBe(200);
    });

    it('lets only a key\'s own issuer keep its old secret with a planned replace', async () => {
      const { user } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read']);
      const byOther = await apiCall(base, admin.token, 'POST', `/api-keys/${key.key.id}/replace`, { mode: 'planned' });
      expect(byOther.status).toBe(400);
      expect(await works(key.token)).toBe(200);
      const byOwner = await apiCall<IssuedApiKey>(base, user.token, 'POST', `/api-keys/${key.key.id}/replace`, { mode: 'planned' });
      expect(byOwner.status).toBe(201);
      expect(await works(key.token)).toBe(200);
    });

    it('takes no window or deadline any more: issuedKeys is not an option', async () => {
      const { user } = await holderOf(MANAGER);
      const key = await issue(user, ['channels:read']);
      expect((await apiCall(base, admin.token, 'PUT', `/users/${user.id}`, { enabled: false, issuedKeys: 'replace_within_7_days' })).status).toBe(200);
      expect((await view(key.key.id)).status).toBe('disabled');
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
      // Each holder has a role of their own, so this narrows only the first issuer.
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
