// ===========================================
// Scoped assignments (real Postgres, #266 slice 10a)
// ===========================================
// PUT /users/:id/assignments replaces what a user holds with roles over every
// channel or over channel groups. The grant service refuses a scope the role
// cannot have, a scope the actor does not hold the role on, the Default group,
// the actor's own assignments and an expiry in the past; a role edit is judged
// on the scopes the role is assigned over.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AssignmentView } from '@galvanigraph/core-models';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, loadServerModules, userWithRole,
  type ApiAnswer, type ServerModules, type TestUser,
} from './_setup.js';

describeIntegration('scoped assignments (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const groups: string[] = [];
  const roleIds: string[] = [];
  const LAB_CHANNEL = randomUUID();
  const RAD_CHANNEL = randomUUID();
  let lab: string;
  let rad: string;
  let admin: TestUser;

  async function user(role: string | null, groupIds: readonly string[] | null = null): Promise<TestUser> {
    const made = await userWithRole(mods.pool, role, groupIds);
    users.push(made.id);
    return made;
  }

  async function roleId(name: string): Promise<string> {
    const { rows } = await mods.pool.query<{ id: string }>('SELECT id FROM roles WHERE name = $1', [name]);
    return rows[0]!.id;
  }

  /** A role holding exactly `permissions`, made directly so the test does not depend on the role routes. */
  async function customRole(permissions: readonly string[]): Promise<string> {
    const { rows } = await mods.pool.query<{ id: string }>('INSERT INTO roles (name) VALUES ($1) RETURNING id', [`itest-role-${randomUUID().slice(0, 8)}`]);
    const id = rows[0]!.id;
    roleIds.push(id);
    for (const p of permissions) await mods.pool.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [id, p]);
    return id;
  }

  const call = <T>(who: TestUser, method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> => apiCall<T>(base, who.token, method, path, body);
  const put = (who: TestUser, target: TestUser, assignments: unknown[]): Promise<ApiAnswer<AssignmentView[]>> =>
    call<AssignmentView[]>(who, 'PUT', `/users/${target.id}/assignments`, { assignments });

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    lab = await insertTestGroup(mods.pool);
    rad = await insertTestGroup(mods.pool);
    groups.push(lab, rad);
    await insertTestChannel(mods, LAB_CHANNEL);
    await insertTestChannel(mods, RAD_CHANNEL);
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2), ($3, $4)', [lab, LAB_CHANNEL, rad, RAD_CHANNEL]);
    admin = await user('admin');
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    if (roleIds.length > 0) await mods.pool.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [roleIds]);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = ANY($1::uuid[])', [[LAB_CHANNEL, RAD_CHANNEL]]);
    await deleteTestChannel(mods, LAB_CHANNEL);
    await deleteTestChannel(mods, RAD_CHANNEL);
    if (groups.length > 0) await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [groups]);
    await mods.pool.end();
  });

  it('gives a user a role on one group, which reaches that group\'s channels only, and records it', async () => {
    const target = await user(null);
    const set = await put(admin, target, [{ roleId: await roleId('channel-viewer'), groupIds: [lab], reason: 'lab on-call' }]);
    expect(set.status).toBe(200);
    expect(set.json.data).toMatchObject([{ roleName: 'channel-viewer', groupIds: [lab], reason: 'lab on-call', live: true }]);
    expect((await call(target, 'GET', `/channels/${LAB_CHANNEL}`)).status).toBe(200);
    expect((await call(target, 'GET', `/channels/${RAD_CHANNEL}`)).status).toBe(404);

    const listed = await call<AssignmentView[]>(admin, 'GET', `/users/${target.id}/assignments`);
    expect(listed.json.data).toMatchObject([{ roleName: 'channel-viewer', groupIds: [lab] }]);
    const { rows } = await mods.pool.query<{ attributes: { targetUserId: string } }>(
      `SELECT attributes FROM audit_log WHERE action = 'ASSIGNMENTS_CHANGED' AND attributes->>'targetUserId' = $1`, [target.id],
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses a scope the role cannot have, the Default group, and an expiry in the past', async () => {
    const target = await user(null);
    const trust = await customRole(['settings:write']);
    expect((await put(admin, target, [{ roleId: trust, groupIds: [lab] }])).status).toBe(400);
    const { rows } = await mods.pool.query<{ id: string }>(`SELECT id FROM channel_groups WHERE name = 'Default'`);
    if (rows[0]) expect((await put(admin, target, [{ roleId: await roleId('channel-viewer'), groupIds: [rows[0].id] }])).status).toBe(400);
    const past = new Date(Date.now() - 60_000).toISOString();
    expect((await put(admin, target, [{ roleId: await roleId('channel-viewer'), groupIds: [lab], expiresAt: past }])).status).toBe(400);
    expect((await call<AssignmentView[]>(admin, 'GET', `/users/${target.id}/assignments`)).json.data).toEqual([]);
  });

  it('needs the actor to hold the role\'s permissions on every group of the scope', async () => {
    const manager = await user(null);
    await put(admin, manager, [
      { roleId: await customRole(['users:read', 'users:write']), groupIds: null },
      { roleId: await roleId('channel-viewer'), groupIds: [lab] },
    ]);
    const target = await user(null);
    expect((await put(manager, target, [{ roleId: await roleId('channel-viewer'), groupIds: [rad] }])).status).toBe(403);
    expect((await put(manager, target, [{ roleId: await roleId('channel-viewer'), groupIds: [lab, rad] }])).status).toBe(403);
    expect((await put(manager, target, [{ roleId: await roleId('channel-deployer'), groupIds: [lab] }])).status).toBe(403);
    expect((await put(manager, target, [{ roleId: await roleId('channel-viewer'), groupIds: null }])).status).toBe(403);
    expect((await put(manager, target, [{ roleId: await roleId('channel-viewer'), groupIds: [lab] }])).status).toBe(200);
  });

  it('judges the single-role path and the target rule on scope, not on a flat list of permissions', async () => {
    // The manager can manage users, and holds Developer on Lab only.
    const manager = await user(null);
    await put(admin, manager, [
      { roleId: await customRole(['users:read', 'users:write']), groupIds: null },
      { roleId: await roleId('channel-developer'), groupIds: [lab] },
    ]);
    // Creating a user with an all-channel role needs that role on every channel.
    const name = `itest-new-${randomUUID().slice(0, 8)}`;
    const created = await call<{ id: string }>(manager, 'POST', '/users', { username: name, email: `${name}@example.test`, password: 'Itest-password-1!', role: 'channel-developer' });
    if (created.json.data) users.push(created.json.data.id);
    expect(created.status).toBe(403);

    // Resetting the password of someone holding channels:write on every channel is out of the manager's reach.
    const wide = await user('channel-developer');
    expect((await call(manager, 'POST', `/users/${wide.id}/password`, { newPassword: 'Itest-password-2!' })).status).toBe(403);
    // Someone holding it on Lab only is within it.
    const narrow = await user(null);
    await put(admin, narrow, [{ roleId: await roleId('channel-developer'), groupIds: [lab] }]);
    expect((await call(manager, 'POST', `/users/${narrow.id}/password`, { newPassword: 'Itest-password-2!' })).status).toBe(204);
  });

  it('refuses the single-role change for a user whose access is set per group, rather than wiping it', async () => {
    const target = await user(null);
    await put(admin, target, [{ roleId: await roleId('channel-viewer'), groupIds: [lab] }]);
    expect((await call(admin, 'PUT', `/users/${target.id}`, { role: 'viewer' })).status).toBe(409);
    expect((await call<AssignmentView[]>(admin, 'GET', `/users/${target.id}/assignments`)).json.data).toMatchObject([{ groupIds: [lab] }]);
  });

  it('stores a blank reason as none', async () => {
    const target = await user(null);
    const set = await put(admin, target, [{ roleId: await roleId('channel-viewer'), groupIds: [lab], reason: '   ' }]);
    expect(set.json.data?.[0]?.reason).toBeNull();
  });

  it('refuses renaming a group to or from Default', async () => {
    const { rows } = await mods.pool.query<{ id: string; revision: number }>(`SELECT id, revision FROM channel_groups WHERE name = 'Default'`);
    const labRow = await mods.pool.query<{ revision: number }>('SELECT revision FROM channel_groups WHERE id = $1', [lab]);
    expect((await call(admin, 'PUT', `/channel-groups/${lab}`, { name: 'Default', revision: labRow.rows[0]!.revision })).status).toBe(400);
    if (rows[0]) expect((await call(admin, 'PUT', `/channel-groups/${rows[0].id}`, { name: `itest-${randomUUID().slice(0, 8)}`, revision: rows[0].revision })).status).toBe(400);
  });

  it('refuses changing your own assignments', async () => {
    expect((await put(admin, admin, [{ roleId: await roleId('viewer'), groupIds: null }])).status).toBe(403);
  });

  it('judges a role edit on the scopes the role is assigned over', async () => {
    const role = await customRole(['channels:read']);
    const holder = await user(null);
    await put(admin, holder, [{ roleId: role, groupIds: [rad] }]);

    // An actor holding channels:write on Lab only cannot add it to a role used on Rad.
    const editor = await user(null);
    await put(admin, editor, [
      { roleId: await customRole(['roles:read', 'roles:write', 'users:read']), groupIds: null },
      { roleId: await roleId('channel-developer'), groupIds: [lab] },
    ]);
    expect((await call(editor, 'PUT', `/roles/${role}`, { permissions: ['channels:read', 'channels:write'] })).status).toBe(403);

    // A permission limited to all-channel assignments cannot join a role assigned over a group.
    const refused = await call(admin, 'PUT', `/roles/${role}`, { permissions: ['channels:read', 'settings:write'] });
    expect(refused.status).toBe(409);
  });
});
