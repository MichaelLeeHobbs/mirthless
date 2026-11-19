// The changes go through the API so each is recorded the way production records
// it; the replay (lib/grant-replay.ts) reads only those records (#266).

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ChannelAccessView } from '@galvanigraph/core-models';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, loadServerModules, userWithRole,
  type ServerModules, type TestUser,
} from './_setup.js';

describeIntegration('who could access a channel as of a past time (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const CHANNEL = randomUUID();
  let lab: string;
  let rad: string;
  let admin: TestUser;
  let labViewer: TestUser;
  let radViewer: TestUser;
  let lapsing: TestUser;
  const roles: string[] = [];
  const LAPSES = new Date(Date.now() + 7 * 24 * 3_600_000);

  async function user(role: string, groupIds: readonly string[] | null): Promise<TestUser> {
    const made = await userWithRole(mods.pool, role, groupIds);
    users.push(made.id);
    return made;
  }

  /** The audit rows are stamped with the database's clock, not this process's. */
  async function mark(): Promise<string> {
    const { rows } = await mods.pool.query<{ t: Date }>('SELECT clock_timestamp() AS t');
    return rows[0]!.t.toISOString();
  }

  function ourPeople(view: ChannelAccessView, ours: ReadonlySet<string>): unknown[] {
    return view.people.filter((p) => ours.has(p.userId)).sort((a, b) => a.userId.localeCompare(b.userId))
      .map((p) => ({ ...p, through: [...p.through].sort((a, b) => a.role.localeCompare(b.role)) }));
  }

  async function holdersAt(asOf: string): Promise<ReadonlySet<string>> {
    const res = await apiCall<ChannelAccessView>(base, admin.token, 'GET', `/channels/${CHANNEL}/access?asOf=${encodeURIComponent(asOf)}`);
    expect(res.status).toBe(200);
    expect(res.json.data!.asOf).toBe(asOf);
    return new Set(res.json.data!.people.map((p) => p.userId));
  }

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    lab = await insertTestGroup(mods.pool);
    rad = await insertTestGroup(mods.pool);
    await insertTestChannel(mods, CHANNEL);
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2)', [lab, CHANNEL]);
    admin = await user('admin', null);
    labViewer = await user('channel-viewer', [lab]);
    radViewer = await user('channel-viewer', [rad]);
    // An end time the baseline must carry through its own formatting.
    lapsing = await user('channel-viewer', [lab]);
    await mods.pool.query('UPDATE assignments SET expires_at = $2 WHERE user_id = $1', [lapsing.id, LAPSES]);
    // The rows above went in directly, as the seed's do; a baseline after them is where the replay starts.
    await mods.pool.query(`SELECT public.record_grant_baseline('channel-access-as-of itest')`);
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    if (roles.length > 0) await mods.pool.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [roles]);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [CHANNEL]);
    await deleteTestChannel(mods, CHANNEL);
    await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [[lab, rad]]);
    await mods.pool.end();
  });

  it('follows assignments, memberships and disabling over time', async () => {
    const t0 = await mark();

    expect((await apiCall(base, admin.token, 'PUT', `/users/${labViewer.id}/assignments`, { assignments: [] })).status).toBe(200);
    const t1 = await mark();

    // The channel joins Radiology: the radiology viewer gains it.
    expect((await apiCall(base, admin.token, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [lab, rad] })).status).toBe(200);
    const t2 = await mark();

    expect((await apiCall(base, admin.token, 'PUT', `/users/${radViewer.id}`, { enabled: false })).status).toBe(200);
    const t3 = await mark();

    const at0 = await holdersAt(t0);
    expect(at0.has(labViewer.id)).toBe(true);
    expect(at0.has(radViewer.id)).toBe(false);
    expect(at0.has(admin.id)).toBe(true);

    const at1 = await holdersAt(t1);
    expect(at1.has(labViewer.id)).toBe(false);
    expect(at1.has(radViewer.id)).toBe(false);

    const at2 = await holdersAt(t2);
    expect(at2.has(radViewer.id)).toBe(true);

    const at3 = await holdersAt(t3);
    expect(at3.has(radViewer.id)).toBe(false);
    expect(at3.has(admin.id)).toBe(true);

    const live = (await apiCall<ChannelAccessView>(base, admin.token, 'GET', `/channels/${CHANNEL}/access`)).json.data!;
    expect(live.asOf).toBeNull();
    const ours = new Set(users);
    const rebuilt = (await apiCall<ChannelAccessView>(base, admin.token, 'GET', `/channels/${CHANNEL}/access?asOf=${encodeURIComponent(await mark())}`)).json.data!;
    expect(ourPeople(rebuilt, ours)).toEqual(ourPeople(live, ours));
    expect(ourPeople(rebuilt, ours).length).toBeGreaterThan(0);
  });

  it('carries an end time written by the baseline', async () => {
    const view = (await apiCall<ChannelAccessView>(base, admin.token, 'GET', `/channels/${CHANNEL}/access?asOf=${encodeURIComponent(await mark())}`)).json.data!;
    const person = view.people.find((p) => p.userId === lapsing.id);
    expect(person?.through).toMatchObject([{ role: 'channel-viewer', expiresAt: LAPSES.toISOString() }]);
  });

  it('follows a role created, assigned and changed through the API', async () => {
    const created = await apiCall<{ id: string }>(base, admin.token, 'POST', '/roles', {
      name: `itest-asof-${randomUUID().slice(0, 8)}`, description: 'as-of itest', permissions: ['channels:read', 'messages:read'],
    });
    expect(created.status).toBe(201);
    const roleId = created.json.data!.id;
    roles.push(roleId);
    const holder = await user('viewer', null);
    expect((await apiCall(base, admin.token, 'PUT', `/users/${holder.id}/assignments`, { assignments: [{ roleId, groupIds: [lab] }] })).status).toBe(200);
    const withMessages = await mark();
    expect((await apiCall(base, admin.token, 'PUT', `/roles/${roleId}`, { permissions: ['channels:read'] })).status).toBe(200);
    const without = await mark();

    const at = async (asOf: string): Promise<readonly string[] | undefined> =>
      (await apiCall<ChannelAccessView>(base, admin.token, 'GET', `/channels/${CHANNEL}/access?asOf=${encodeURIComponent(asOf)}`))
        .json.data!.people.find((p) => p.userId === holder.id)?.permissions;
    expect(await at(withMessages)).toEqual(['channels:read', 'messages:read']);
    expect(await at(without)).toEqual(['channels:read']);
    expect((await apiCall(base, admin.token, 'PUT', `/users/${holder.id}/assignments`, { assignments: [] })).status).toBe(200);
  });

  it('records the memberships a deleted group takes with it', async () => {
    const doomed = await insertTestGroup(mods.pool);
    expect((await apiCall(base, admin.token, 'PUT', `/channels/${CHANNEL}/groups`, { groupIds: [lab, rad, doomed] })).status).toBe(200);
    expect((await apiCall(base, admin.token, 'DELETE', `/channel-groups/${doomed}`)).status).toBeLessThan(300);
    const { rows } = await mods.pool.query<{ attributes: { after: string[]; groupDeleted: string } }>(
      `SELECT attributes FROM audit_log WHERE action = 'CHANNEL_GROUPS_CHANGED' AND channel_id = $1 ORDER BY id DESC LIMIT 1`, [CHANNEL],
    );
    expect(rows[0]?.attributes.groupDeleted).toBe(doomed);
    expect([...rows[0]!.attributes.after].sort()).toEqual([lab, rad].sort());
  });

  it('gives way to a grant change in flight instead of making it wait', async () => {
    const blocker = await mods.pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE assignments IN ROW EXCLUSIVE MODE');
      await expect(mods.pool.query(`SELECT public.record_grant_baseline('blocked')`)).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    const { GrantService } = await import('../../src/services/grant.service.js');
    // This month already has a baseline (the one this file wrote), so none is added.
    expect(await GrantService.ensureMonthlyBaseline()).toBe('exists');
  });

  it('lets a lapsed assignment go at its end time', async () => {
    const temp = await user('channel-viewer', null);
    const roleId = (await mods.pool.query<{ id: string }>(`SELECT id FROM roles WHERE name = 'channel-viewer'`)).rows[0]!.id;
    const ends = new Date(Date.now() + 1500).toISOString();
    const put = await apiCall(base, admin.token, 'PUT', `/users/${temp.id}/assignments`, { assignments: [{ roleId, groupIds: [lab], expiresAt: ends }] });
    expect(put.status).toBe(200);
    const during = await mark();
    await expect.poll(async () => Date.now() > Date.parse(ends) + 100, { timeout: 5000 }).toBe(true);
    expect((await holdersAt(during)).has(temp.id)).toBe(true);
    expect((await holdersAt(await mark())).has(temp.id)).toBe(false);
  });

  it('refuses a time before the history starts, or in the future', async () => {
    const before = await apiCall(base, admin.token, 'GET', `/channels/${CHANNEL}/access?asOf=${encodeURIComponent('2000-01-01T00:00:00.000Z')}`);
    expect(before.status).toBe(400);
    expect(before.json.error?.message).toMatch(/history starts at/);
    const future = await apiCall(base, admin.token, 'GET', `/channels/${CHANNEL}/access?asOf=${encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString())}`);
    expect(future.status).toBe(400);
    expect((await apiCall(base, admin.token, 'GET', `/channels/${CHANNEL}/access?asOf=yesterday`)).status).toBe(400);
  });

  it('writes one grant row when a user is disabled, and none when nothing changed', async () => {
    const target = await user('viewer', null);
    const count = async (): Promise<number> => (await mods.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'USER_ENABLED_CHANGED' AND attributes->>'targetUserId' = $1`, [target.id],
    )).rows[0]!.n;
    expect((await apiCall(base, admin.token, 'PUT', `/users/${target.id}`, { enabled: true })).status).toBe(200);
    expect(await count()).toBe(0);
    expect((await apiCall(base, admin.token, 'DELETE', `/users/${target.id}`)).status).toBeLessThan(300);
    expect(await count()).toBe(1);
  });
});
