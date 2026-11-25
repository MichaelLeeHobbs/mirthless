// Adding a channel to a group gives everyone the group's assignments cover
// those permissions on the channel, so the actor must already hold them there.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, closeServer, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, listen, loadServerModules, userWithRole,
  type ApiAnswer, type ServerModules, type TestUser,
} from './_setup.js';

describeIntegration('group membership and group rules (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const groups: string[] = [];
  const CHANNEL = randomUUID();

  async function userWith(role: string, groupId: string | null): Promise<TestUser> {
    const made = await userWithRole(mods.pool, role, groupId === null ? null : [groupId]);
    users.push(made.id);
    return made;
  }

  async function group(): Promise<string> {
    const id = await insertTestGroup(mods.pool);
    groups.push(id);
    return id;
  }

  const call = (token: string, method: string, path: string, body?: unknown): Promise<ApiAnswer<unknown>> => apiCall(base, token, method, path, body);

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    await insertTestChannel(mods, CHANNEL);
    const app = (await import('../../src/app.js')).default;
    ({ server, base } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
    await mods.pool.query('DELETE FROM users WHERE id IN (SELECT user_id FROM api_keys WHERE issued_by = ANY($1::uuid[]))', [users]);
    await mods.pool.query('DELETE FROM roles WHERE key_role AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.role_id = roles.id)');
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
    if (groups.length > 0) await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [groups]);
    await deleteTestChannel(mods, CHANNEL);
    await mods.pool.end();
  });

  it('refuses adding a channel to a group whose assignments grant more than the actor holds on it, and records an allowed one', async () => {
    const lab = await group();
    await userWith('channel-deployer', lab); // the Lab group now grants deploy
    const developer = await userWith('developer', null); // channels:write everywhere, no deploy
    const refused = await call(developer.token, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [lab] });
    expect(refused.status).toBe(403);
    expect(refused.json.error?.details?.missing).toContain('channels:deploy');

    const admin = await userWith('admin', null);
    expect((await call(admin.token, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [lab] })).status).toBe(200);
    const { rows } = await mods.pool.query<{ attributes: { after: string[] } }>(
      `SELECT attributes FROM audit_log WHERE action = 'CHANNEL_GROUPS_CHANGED' AND channel_id = $1 ORDER BY id DESC LIMIT 1`, [CHANNEL],
    );
    expect(rows[0]?.attributes.after).toEqual([lab]);

    // Taking the channel out of the group narrows access: channels:write on it is enough.
    expect((await call(developer.token, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [] })).status).toBe(200);
  });

  it('judges a scoped actor on the channel\'s groups before the change, never on the groups being added', async () => {
    const lab = await group();
    const rad = await group();
    // The channel starts in Lab. The actor deploys on Rad only, and writes on Lab.
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2)', [lab, CHANNEL]);
    const actor = await userWith('channel-developer', lab);
    const deployOnRad = await mods.pool.query<{ id: string }>(
      `INSERT INTO assignments (user_id, role_id, all_channels) SELECT $1, id, false FROM roles WHERE name = 'channel-deployer' RETURNING id`, [actor.id],
    );
    await mods.pool.query('INSERT INTO assignment_groups (assignment_id, channel_group_id) VALUES ($1, $2)', [deployOnRad.rows[0]!.id, rad]);

    // Adding Rad hands Rad's deploy to the channel; the actor holds deploy only on Rad, not on this channel: refused.
    // That is also the self-grant: the deploy the actor would gain is their own.
    const refused = await call(actor.token, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [lab, rad] });
    expect(refused.status).toBe(403);
    expect(refused.json.error?.details?.missing).toContain('channels:deploy');
    // Remove Lab and add Rad in one call: judged on Lab, so still refused.
    expect((await call(actor.token, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [rad] })).status).toBe(403);
  });

  it('counts a group\'s expired assignments when a channel joins it, since renewing one gives that channel too', async () => {
    const old = await group();
    const lapsed = await userWith('channel-deployer', old);
    await mods.pool.query(`UPDATE assignments SET expires_at = now() - interval '1 day' WHERE user_id = $1`, [lapsed.id]);
    const developer = await userWith('developer', null);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
    const refused = await call(developer.token, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [old] });
    expect(refused.status).toBe(403);
    expect(refused.json.error?.details?.missing).toContain('channels:deploy');

    const admin = await userWith('admin', null);
    expect((await call(admin.token, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [old] })).status).toBe(200);
  });

  it.each(['ended', 'revoked'] as const)('does not count an API key that is %s, which nothing renews', async (how) => {
    const old = await group();
    const admin = await userWith('admin', null);
    const issued = await call(admin.token, 'POST', '/api-keys', {
      name: `itest-${randomUUID().slice(0, 8)}`, permissions: ['channels:deploy'], groupIds: [old], expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(issued.status).toBe(201);
    const developer = await userWith('developer', null);
    const join = async (): Promise<number> => (await call(developer.token, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [old] })).status;
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);

    expect(await join()).toBe(403);
    if (how === 'ended') await mods.pool.query(`UPDATE assignments SET expires_at = now() - interval '1 day' WHERE user_id IN (SELECT user_id FROM api_keys WHERE issued_by = $1)`, [admin.id]);
    else expect((await call(admin.token, 'POST', `/api-keys/${(issued.json as { data: { key: { id: string } } }).data.key.id}/revoke`, { reason: 'Done with it' })).status).toBe(200);
    expect(await join()).toBe(200);
  });

  it('lets only an all-channel channels:write holder create, rename or delete a group', async () => {
    const lab = await group();
    const scoped = await userWith('channel-developer', lab);
    expect((await call(scoped.token, 'POST', '/channel-groups', { name: `itest-grp-${randomUUID().slice(0, 8)}` })).status).toBe(403);
    expect((await call(scoped.token, 'PUT', `/channel-groups/${lab}`, { name: 'renamed', revision: 1 })).status).toBe(403);
    expect((await call(scoped.token, 'DELETE', `/channel-groups/${lab}`)).status).toBe(403);
  });

  it('marks the groups a live assignment is scoped to as giving access', async () => {
    const used = await group();
    const lapsed = await group();
    const unused = await group();
    await userWith('channel-viewer', used);
    const old = await userWith('channel-viewer', lapsed);
    await mods.pool.query(`UPDATE assignments SET expires_at = now() - interval '1 day' WHERE user_id = $1`, [old.id]);
    const admin = await userWith('admin', null);
    const listed = await call(admin.token, 'GET', '/channel-groups');
    const byId = new Map((listed.json as { data: Array<{ id: string; givesAccess: boolean }> }).data.map((g) => [g.id, g.givesAccess]));
    expect([byId.get(used), byId.get(lapsed), byId.get(unused)]).toEqual([true, false, false]);
  });

  it('refuses to delete a group an assignment scopes to', async () => {
    const lab = await group();
    await userWith('channel-viewer', lab);
    const admin = await userWith('admin', null);
    const refused = await call(admin.token, 'DELETE', `/channel-groups/${lab}`);
    expect(refused.status).toBe(409);
    expect(refused.json.error?.code).toBe('CONFLICT');
  });
});
