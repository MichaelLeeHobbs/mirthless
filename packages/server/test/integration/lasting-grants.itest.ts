// #355: what someone holds for a time, they can give only until then.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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

    expect((await give(null)).status).toBe(403);
    expect((await give(new Date(until.getTime() + HOUR_MS).toISOString())).status).toBe(403);
    expect((await give(until.toISOString())).status).toBe(200);
  });

  it('refuses giving a role with no end through the single-role paths', async () => {
    const manager = await user();
    const reader = await customRole(['channels:read']);
    await assign(manager, (await customRole(['users:read', 'users:write'])).id);
    await assign(manager, reader.id, { until: inAnHour() });
    const target = await user();

    expect((await call(manager, 'PUT', `/users/${target.id}`, { role: reader.name })).status).toBe(403);
    const name = `itest-new-${randomUUID().slice(0, 8)}`;
    const created = await call<{ id: string }>(manager, 'POST', '/users', { username: name, email: `${name}@example.test`, password: 'Itest-password-1!', role: reader.name });
    if (created.json.data) users.push(created.json.data.id);
    expect(created.status).toBe(403);
  });

  it('refuses moving a channel held until a time into a group one holds with no end', async () => {
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
  });
});
