// ===========================================
// Who can access a channel (real Postgres, #266 slice 11)
// ===========================================
// GET /channels/:id/access lists every enabled person whose live assignments
// cover the channel, with the channel permissions they give and through which
// role and scope, plus who reaches every channel through code or shared data.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ChannelAccessView } from '@galvanigraph/core-models';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, loadServerModules, userWithRole,
  type ServerModules, type TestUser,
} from './_setup.js';

describeIntegration('who can access a channel (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const groups: string[] = [];
  const CHANNEL = randomUUID();
  let admin: TestUser;
  let labViewer: TestUser;
  let radViewer: TestUser;
  let developer: TestUser;
  let disabled: TestUser;
  let lapsed: TestUser;

  async function user(role: string, groupIds: readonly string[] | null): Promise<TestUser> {
    const made = await userWithRole(mods.pool, role, groupIds);
    users.push(made.id);
    return made;
  }

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    const lab = await insertTestGroup(mods.pool);
    const rad = await insertTestGroup(mods.pool);
    groups.push(lab, rad);
    await insertTestChannel(mods, CHANNEL);
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2)', [lab, CHANNEL]);
    admin = await user('admin', null);
    labViewer = await user('channel-viewer', [lab]);
    radViewer = await user('channel-viewer', [rad]);
    developer = await user('developer', null);
    disabled = await user('channel-viewer', [lab]);
    await mods.pool.query('UPDATE users SET enabled = false WHERE id = $1', [disabled.id]);
    lapsed = await user('channel-viewer', [lab]);
    await mods.pool.query(`UPDATE assignments SET expires_at = now() - interval '1 day' WHERE user_id = $1`, [lapsed.id]);
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
    await deleteTestChannel(mods, CHANNEL);
    if (groups.length > 0) await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [groups]);
    await mods.pool.end();
  });

  it('lists the people whose live assignments cover the channel, and how', async () => {
    const res = await apiCall<ChannelAccessView>(base, admin.token, 'GET', `/channels/${CHANNEL}/access`);
    expect(res.status).toBe(200);
    const view = res.json.data!;
    const byId = new Map(view.people.map((p) => [p.userId, p]));
    expect(byId.get(labViewer.id)).toMatchObject({ through: [{ role: 'channel-viewer', groupIds: [groups[0]], expiresAt: null }] });
    expect(byId.get(labViewer.id)?.permissions).toContain('messages:read');
    expect(byId.get(developer.id)?.through).toMatchObject([{ role: 'developer', groupIds: null, expiresAt: null }]);
    expect(byId.get(developer.id)?.through[0]?.permissions).toContain('channels:write');
    // Scoped elsewhere, disabled, or expired: no access.
    expect(byId.has(radViewer.id)).toBe(false);
    expect(byId.has(disabled.id)).toBe(false);
    expect(byId.has(lapsed.id)).toBe(false);
    // The developer can change channel code, which reaches every channel; the scoped viewer cannot.
    expect(view.throughCode.map((p) => p.userId)).toContain(developer.id);
    expect(view.throughCode.map((p) => p.userId)).not.toContain(labViewer.id);
  });

  it('answers 404 for a channel that does not exist', async () => {
    expect((await apiCall(base, admin.token, 'GET', `/channels/${randomUUID()}/access`)).status).toBe(404);
  });

  it('is for people who may read users', async () => {
    expect((await apiCall(base, labViewer.token, 'GET', `/channels/${CHANNEL}/access`)).status).toBe(403);
  });
});
