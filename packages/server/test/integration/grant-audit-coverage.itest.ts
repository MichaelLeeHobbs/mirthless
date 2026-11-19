// Who could access what, and when, is rebuilt from the audit log, so each
// change to an assignment, a group membership or a role writes exactly one
// audit row in the same transaction.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, loadServerModules, userWithRole,
  type ServerModules, type TestUser,
} from './_setup.js';

describeIntegration('every grant write is recorded once (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const groups: string[] = [];
  const roleIds: string[] = [];
  const CHANNEL = randomUUID();
  let admin: TestUser;

  async function auditRows(action: string): Promise<number> {
    const { rows } = await mods.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_log WHERE action = $1', [action]);
    return rows[0]!.n;
  }

  async function recorded(write: () => Promise<{ status: number }>): Promise<Record<string, number>> {
    const actions = ['ASSIGNMENTS_CHANGED', 'CHANNEL_GROUPS_CHANGED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED'];
    const before = await Promise.all(actions.map(auditRows));
    const res = await write();
    expect(res.status).toBeLessThan(300);
    const after = await Promise.all(actions.map(auditRows));
    return Object.fromEntries(actions.map((a, i) => [a, after[i]! - before[i]!]).filter(([, n]) => n !== 0));
  }

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    groups.push(await insertTestGroup(mods.pool));
    await insertTestChannel(mods, CHANNEL);
    admin = await userWithRole(mods.pool, 'admin', null);
    users.push(admin.id);
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

  it('records one row for each change to roles, assignments and memberships', async () => {
    const call = (method: string, path: string, body?: unknown): Promise<{ status: number; json: { data?: unknown } }> => apiCall(base, admin.token, method, path, body);
    const name = `itest-audit-${randomUUID().slice(0, 8)}`;

    let userId = '';
    expect(await recorded(async () => {
      const res = await call('POST', '/users', { username: name, email: `${name}@example.test`, password: 'Itest-password-1!', role: 'viewer' });
      userId = (res.json.data as { id: string }).id;
      users.push(userId);
      return res;
    })).toEqual({ ASSIGNMENTS_CHANGED: 1 });

    let roleId = '';
    expect(await recorded(async () => {
      const res = await call('POST', '/roles', { name, permissions: ['channels:read'] });
      roleId = (res.json.data as { id: string }).id;
      roleIds.push(roleId);
      return res;
    })).toEqual({ ROLE_CREATED: 1 });

    expect(await recorded(() => call('PUT', `/roles/${roleId}`, { permissions: ['channels:read', 'messages:read'] }))).toEqual({ ROLE_UPDATED: 1 });
    expect(await recorded(() => call('PUT', `/users/${userId}/assignments`, { assignments: [{ roleId, groupIds: [groups[0]] }] }))).toEqual({ ASSIGNMENTS_CHANGED: 1 });
    expect(await recorded(() => call('PUT', `/channels/${CHANNEL}/groups`, { groupIds: [groups[0]] }))).toEqual({ CHANNEL_GROUPS_CHANGED: 1 });
    expect(await recorded(() => call('PUT', `/users/${userId}/assignments`, { assignments: [] }))).toEqual({ ASSIGNMENTS_CHANGED: 1 });
    expect(await recorded(() => call('DELETE', `/roles/${roleId}`))).toEqual({ ROLE_DELETED: 1 });
    expect(await recorded(() => call('PUT', `/users/${userId}`, { role: 'developer' }))).toEqual({ ASSIGNMENTS_CHANGED: 1 });

    let created = '';
    expect(await recorded(async () => {
      const res = await call('POST', '/channels', {
        name: `itest-audit-${randomUUID().slice(0, 8)}`, inboundDataType: 'RAW', outboundDataType: 'RAW',
        sourceConnectorType: 'CHANNEL', sourceConnectorProperties: {}, responseMode: 'NONE', groupId: groups[0],
      });
      created = (res.json.data as { id: string }).id;
      return res;
    })).toEqual({ CHANNEL_GROUPS_CHANGED: 1 });
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [created]);
    await mods.pool.query('UPDATE channels SET deleted_at = now() WHERE id = $1', [created]);

    const imported = randomUUID();
    expect(await recorded(() => call('POST', '/channels/import', {
      version: 1, exportedAt: new Date().toISOString(), collisionMode: 'SKIP', groupId: groups[0],
      channels: [{ id: imported, name: `itest-audit-${randomUUID().slice(0, 8)}`, description: '', enabled: false, revision: 1, inboundDataType: 'RAW', outboundDataType: 'RAW',
        sourceConnectorType: 'CHANNEL', sourceConnectorProperties: {}, responseMode: 'NONE', responseConnectorName: null, initialState: 'STOPPED',
        messageStorageMode: 'DEVELOPMENT', encryptData: false, removeContentOnCompletion: false, removeAttachmentsOnCompletion: false,
        pruningEnabled: false, pruningMaxAgeDays: null, pruningArchiveEnabled: false, scripts: [], destinations: [], metadataColumns: [], filters: [], transformers: [] }],
    }))).toEqual({ CHANNEL_GROUPS_CHANGED: 1 });
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [imported]);
    const { GrantService } = await import('../../src/services/grant.service.js');
    expect(await recorded(async () => { await GrantService.restoreMembership(imported, groups[0]!, { userId: admin.id }); return { status: 200 }; }))
      .toEqual({ CHANNEL_GROUPS_CHANGED: 1 });
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [imported]);
    await mods.pool.query('UPDATE channels SET deleted_at = now() WHERE id = $1', [imported]);
  });
});
