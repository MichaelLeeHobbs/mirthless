// #355: what someone holds for a time, they can give only until then.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IssuedApiKey } from '@galvanigraph/core-models';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, loadServerModules, userWithRole,
  type ApiAnswer, type ServerModules, type TestUser,
} from './_setup.js';

const HOUR_MS = 3_600_000;

describeIntegration('access given by someone who holds it for a time (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const groups: string[] = [];
  const roleIds: string[] = [];
  const CHANNEL = randomUUID();

  async function user(role: string | null = null): Promise<TestUser> {
    const made = await userWithRole(mods.pool, role, null);
    users.push(made.id);
    return made;
  }

  async function customRole(permissions: readonly string[]): Promise<{ id: string; name: string }> {
    const name = `itest-role-${randomUUID().slice(0, 8)}`;
    const { rows } = await mods.pool.query<{ id: string }>('INSERT INTO roles (name) VALUES ($1) RETURNING id', [name]);
    const id = rows[0]!.id;
    roleIds.push(id);
    for (const p of permissions) await mods.pool.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [id, p]);
    return { id, name };
  }

  async function assign(who: TestUser, roleId: string, options: { groupId?: string; until?: Date } = {}): Promise<void> {
    const { rows } = await mods.pool.query<{ id: string }>(
      'INSERT INTO assignments (user_id, role_id, all_channels, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [who.id, roleId, options.groupId === undefined, options.until ?? null],
    );
    if (options.groupId !== undefined) {
      await mods.pool.query('INSERT INTO assignment_groups (assignment_id, channel_group_id) VALUES ($1, $2)', [rows[0]!.id, options.groupId]);
    }
  }

  const call = <T = unknown>(who: TestUser, method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> => apiCall<T>(base, who.token, method, path, body);
  const inAnHour = (): Date => new Date(Date.now() + HOUR_MS);

  async function group(): Promise<string> {
    const id = await insertTestGroup(mods.pool);
    groups.push(id);
    return id;
  }

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    await insertTestChannel(mods, CHANNEL);
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    // Keys first: their issuer is one of these users.
    await mods.pool.query('DELETE FROM users WHERE id IN (SELECT user_id FROM api_keys WHERE issued_by = ANY($1::uuid[]))', [users]);
    await mods.pool.query('DELETE FROM roles WHERE key_role AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.role_id = roles.id)');
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    if (roleIds.length > 0) await mods.pool.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [roleIds]);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
    await deleteTestChannel(mods, CHANNEL);
    if (groups.length > 0) await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [groups]);
    await mods.pool.end();
  });

  it('refuses adding a permission held until a time to a role one holds with no end', async () => {
    const editor = await user();
    const own = await customRole(['roles:read', 'roles:write', 'channels:read']);
    await assign(editor, own.id);
    await assign(editor, (await customRole(['channels:deploy'])).id, { until: inAnHour() });

    const answer = await call(editor, 'PUT', `/roles/${own.id}`, { permissions: ['roles:read', 'roles:write', 'channels:read', 'channels:deploy'] });

    expect(answer.status).toBe(403);
    expect(answer.json.error?.details?.missing).toEqual(['channels:deploy']);
  });

  it('lets someone who holds it with no end add a permission to a role they hold', async () => {
    const editor = await user();
    const own = await customRole(['roles:read', 'roles:write']);
    await assign(editor, own.id);
    await assign(editor, (await customRole(['channels:deploy'])).id);

    expect((await call(editor, 'PUT', `/roles/${own.id}`, { permissions: ['roles:read', 'roles:write', 'channels:deploy'] })).status).toBe(200);
  });

  it('refuses an assignment that outlasts the giver\'s own access, and allows one that ends with it', async () => {
    const manager = await user();
    const until = inAnHour();
    const reader = await customRole(['channels:read']);
    await assign(manager, (await customRole(['users:read', 'users:write'])).id);
    await assign(manager, reader.id, { until });
    const target = await user();
    const give = (expiresAt: string | null): Promise<ApiAnswer<unknown>> =>
      call(manager, 'PUT', `/users/${target.id}/assignments`, { assignments: [{ roleId: reader.id, groupIds: null, ...(expiresAt === null ? {} : { expiresAt }) }] });

    for (const tooLate of [null, new Date(until.getTime() + HOUR_MS).toISOString()]) {
      const refused = await give(tooLate);
      expect(refused.status).toBe(403);
      expect(refused.json.error?.details?.missing).toEqual(['channels:read']);
    }
    expect((await give(until.toISOString())).status).toBe(200);
  });

  it('leaves an assignment it did not give as it was, or shorter, but not longer', async () => {
    const manager = await user();
    const until = inAnHour();
    const reader = await customRole(['channels:read']);
    await assign(manager, (await customRole(['users:read', 'users:write'])).id);
    await assign(manager, reader.id, { until });
    const target = await user();
    const later = new Date(until.getTime() + HOUR_MS);
    await assign(target, reader.id, { until: later });
    const resend = (expiresAt: Date | null): Promise<ApiAnswer<unknown>> => call(manager, 'PUT', `/users/${target.id}/assignments`, {
      assignments: [{ roleId: reader.id, groupIds: null, ...(expiresAt === null ? {} : { expiresAt: expiresAt.toISOString() }) }],
    });

    expect((await resend(null)).status).toBe(403);
    expect((await resend(new Date(later.getTime() + HOUR_MS))).status).toBe(403);
    expect((await resend(later)).status).toBe(200);
    expect((await resend(new Date(later.getTime() - 60_000))).status).toBe(200);
    // Shortened to a minute less, so the time taken off is not theirs to give back.
    expect((await resend(later)).status).toBe(403);
  });

  it('lets an assignment it did not give keep or lose groups, but not gain one', async () => {
    const manager = await user();
    const one = await group();
    const two = await group();
    const reader = await customRole(['channels:read']);
    await assign(manager, (await customRole(['users:read', 'users:write'])).id);
    await assign(manager, reader.id, { until: inAnHour() });
    const target = await user();
    const { rows } = await mods.pool.query<{ id: string }>('INSERT INTO assignments (user_id, role_id, all_channels) VALUES ($1, $2, false) RETURNING id', [target.id, reader.id]);
    for (const g of [one, two]) await mods.pool.query('INSERT INTO assignment_groups (assignment_id, channel_group_id) VALUES ($1, $2)', [rows[0]!.id, g]);
    const three = await group();
    const resend = (groupIds: readonly string[]): Promise<ApiAnswer<unknown>> =>
      call(manager, 'PUT', `/users/${target.id}/assignments`, { assignments: [{ roleId: reader.id, groupIds }] });

    expect((await resend([one, two, three])).status).toBe(403);
    expect((await resend([three])).status).toBe(403);
    expect((await resend([two, one])).status).toBe(200);
    expect((await resend([one])).status).toBe(200);
    expect((await resend([one, two])).status).toBe(403);
  });

  it('lets an every-channel assignment it did not give shrink to a group, but not a group one grow to every channel', async () => {
    const manager = await user();
    const one = await group();
    const reader = await customRole(['channels:read']);
    await assign(manager, (await customRole(['users:read', 'users:write'])).id);
    await assign(manager, reader.id, { until: inAnHour() });
    const target = await user();
    await assign(target, reader.id);
    const resend = (groupIds: readonly string[] | null): Promise<ApiAnswer<unknown>> =>
      call(manager, 'PUT', `/users/${target.id}/assignments`, { assignments: [{ roleId: reader.id, groupIds }] });

    expect((await resend(null)).status).toBe(200);
    expect((await resend([one])).status).toBe(200);
    expect((await resend(null)).status).toBe(403);
  });

  it('lets someone put a permission held until a time in a role nobody holds, but not assign that role past it', async () => {
    const editor = await user();
    const until = inAnHour();
    await assign(editor, (await customRole(['roles:read', 'roles:write', 'users:read', 'users:write'])).id);
    await assign(editor, (await customRole(['channels:deploy'])).id, { until });
    const unassigned = await customRole([]);

    expect((await call(editor, 'PUT', `/roles/${unassigned.id}`, { permissions: ['channels:deploy'] })).status).toBe(200);

    const target = await user();
    const answer = await call(editor, 'PUT', `/users/${target.id}/assignments`, { assignments: [{ roleId: unassigned.id, groupIds: null }] });
    expect(answer.status).toBe(403);
    expect(answer.json.error?.details?.missing).toEqual(['channels:deploy']);
  });

  it('refuses giving a role with no end through the single-role paths', async () => {
    const manager = await user();
    const reader = await customRole(['channels:read']);
    await assign(manager, (await customRole(['users:read', 'users:write'])).id);
    await assign(manager, reader.id, { until: inAnHour() });
    const target = await user();

    const changed = await call(manager, 'PUT', `/users/${target.id}`, { role: reader.name });
    expect(changed.status).toBe(403);
    expect(changed.json.error?.message).toContain('Missing: channels:read');
    const name = `itest-new-${randomUUID().slice(0, 8)}`;
    const created = await call<{ id: string }>(manager, 'POST', '/users', { username: name, email: `${name}@example.test`, password: 'Itest-password-1!', role: reader.name });
    if (created.json.data) users.push(created.json.data.id);
    expect(created.status).toBe(403);

    // Held with no end, the same grants pass.
    const lasting = await user();
    await assign(lasting, (await customRole(['users:read', 'users:write', 'channels:read'])).id);
    expect((await call(lasting, 'PUT', `/users/${target.id}`, { role: reader.name })).status).toBe(200);
  });

  it('refuses adding a channel held until a time to a group one holds with no end', async () => {
    const worker = await user();
    const from = await group();
    const to = await group();
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2)', [from, CHANNEL]);
    const developer = await customRole(['channels:read', 'channels:write']);
    await assign(worker, developer.id, { groupId: from, until: inAnHour() });
    await assign(worker, developer.id, { groupId: to });

    const answer = await call(worker, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [from, to] });

    expect(answer.status).toBe(403);
    expect(answer.json.error?.details?.missing).toEqual(['channels:read', 'channels:write']);

    await assign(worker, developer.id, { groupId: from });
    expect((await call(worker, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [from, to] })).status).toBe(200);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
  });

  it('judges each scope on how long it is held there, not on the widest grant held now', async () => {
    const editor = await user();
    const lab = await group();
    const rad = await group();
    const deploy = await customRole(['channels:deploy']);
    await assign(editor, (await customRole(['roles:read', 'roles:write', 'users:read', 'users:write'])).id);
    await assign(editor, deploy.id, { until: inAnHour() });
    await assign(editor, deploy.id, { groupId: lab });
    const onLab = await customRole([]);
    await assign(await user(), onLab.id, { groupId: lab });
    const onRad = await customRole([]);
    await assign(await user(), onRad.id, { groupId: rad });
    const addDeploy = async (roleId: string): Promise<number> => (await call(editor, 'PUT', `/roles/${roleId}`, { permissions: ['channels:deploy'] })).status;
    const give = async (groupIds: readonly string[]): Promise<number> =>
      (await call(editor, 'PUT', `/users/${(await user()).id}/assignments`, { assignments: [{ roleId: deploy.id, groupIds }] })).status;

    expect(await addDeploy(onLab.id)).toBe(200);
    expect(await addDeploy(onRad.id)).toBe(403);
    expect(await give([lab])).toBe(200);
    expect(await give([rad])).toBe(403);
    expect(await give([lab, rad])).toBe(403);
  });

  it('counts a role held only through an expired assignment as assigned, since renewing restores it', async () => {
    const editor = await user();
    await assign(editor, (await customRole(['roles:read', 'roles:write'])).id);
    await assign(editor, (await customRole(['channels:deploy'])).id, { until: inAnHour() });
    const lapsed = await customRole([]);
    await assign(await user(), lapsed.id, { until: new Date(Date.now() - HOUR_MS) });

    expect((await call(editor, 'PUT', `/roles/${lapsed.id}`, { permissions: ['channels:deploy'] })).status).toBe(403);
  });

  it('refuses an API key adding a channel to a group that gives access, since a key always ends', async () => {
    const admin = await user('admin');
    const open = await group();
    const used = await group();
    await assign(await user(), (await customRole(['channels:read'])).id, { groupId: used });
    const issued = await call<IssuedApiKey>(admin, 'POST', '/api-keys', {
      name: `itest-${randomUUID().slice(0, 8)}`, permissions: ['channels:read', 'channels:write'], groupIds: null,
      expiresAt: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
    });
    expect(issued.status).toBe(201);
    const key: TestUser = { id: '', token: issued.json.data!.token };

    expect((await call(key, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [open] })).status).toBe(200);
    const refused = await call(key, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [open, used] });
    expect(refused.status).toBe(403);
    expect(refused.json.error?.details?.missing).toEqual(['channels:read']);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
  });

  it('refuses a restore by someone who may restore only until a time where the membership gives access', async () => {
    const { GrantService } = await import('../../src/services/grant.service.js');
    const restorer = await user();
    const adminRole = await mods.pool.query<{ id: string }>('SELECT id FROM roles WHERE admin');
    await assign(restorer, adminRole.rows[0]!.id, { until: inAnHour() });
    const open = await group();
    const used = await group();
    await assign(restorer, (await customRole(['channels:read'])).id, { groupId: used });

    await GrantService.restoreMembership(CHANNEL, open, { userId: restorer.id });
    await expect(GrantService.restoreMembership(CHANNEL, used, { userId: restorer.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const { rows } = await mods.pool.query<{ id: string }>('SELECT channel_group_id AS id FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
    expect(rows.map((r) => r.id)).toEqual([open]);

    await GrantService.restoreMembership(CHANNEL, used, { userId: (await user('admin')).id });
    const restored = await mods.pool.query<{ id: string }>('SELECT channel_group_id AS id FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
    expect(restored.rows.map((r) => r.id).sort()).toEqual([open, used].sort());
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
  });
});
