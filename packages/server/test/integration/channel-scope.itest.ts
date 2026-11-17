// ===========================================
// Channel routes honour an assignment's group scope (real Postgres, #266 slice 8)
// ===========================================
// A user whose role is assigned on the Lab group only reaches Lab's channels.
// Every route that names a channel answers another channel, or one that does
// not exist, the same way: 404, so scope never shows which channels exist
// outside it. An all-channel user reaches both.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeIntegration, insertTestChannel, deleteTestChannel, loadServerModules, type ServerModules } from './_setup.js';

describeIntegration('channel scope on channel routes (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const LAB_CHANNEL = randomUUID();
  const RAD_CHANNEL = randomUUID();
  let labGroup: string;
  let radGroup: string;
  let scopedToken: string;
  let allToken: string;

  async function userWith(role: string, groupId: string | null): Promise<string> {
    const { signAccessToken } = await import('../../src/lib/jwt.js');
    const name = `itest-scope-${randomUUID().slice(0, 8)}`;
    const { rows } = await mods.pool.query<{ id: string }>(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'not-a-hash') RETURNING id`, [name, `${name}@example.test`],
    );
    const id = rows[0]!.id;
    users.push(id);
    const assigned = await mods.pool.query<{ id: string }>(
      `INSERT INTO assignments (user_id, role_id, all_channels) SELECT $1, id, $3 FROM roles WHERE name = $2 RETURNING id`,
      [id, role, groupId === null],
    );
    if (groupId !== null) {
      await mods.pool.query('INSERT INTO assignment_groups (assignment_id, channel_group_id) VALUES ($1, $2)', [assigned.rows[0]!.id, groupId]);
    }
    const session = await mods.pool.query<{ id: string }>(
      `INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, now() + interval '1 hour') RETURNING id`, [id, `itest-${randomUUID()}`],
    );
    return signAccessToken({ userId: id, sessionId: session.rows[0]!.id });
  }

  async function group(name: string, channelId: string): Promise<string> {
    const { rows } = await mods.pool.query<{ id: string }>('INSERT INTO channel_groups (name) VALUES ($1) RETURNING id', [name]);
    const id = rows[0]!.id;
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2)', [id, channelId]);
    return id;
  }

  async function call(token: string, method: string, path: string): Promise<{ status: number; code: string | undefined; message: string | undefined }> {
    const res = await fetch(`${base}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) });
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    return { status: res.status, code: json.error?.code, message: json.error?.message };
  }

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    await insertTestChannel(mods, LAB_CHANNEL);
    await insertTestChannel(mods, RAD_CHANNEL);
    labGroup = await group(`itest-lab-${randomUUID().slice(0, 8)}`, LAB_CHANNEL);
    radGroup = await group(`itest-rad-${randomUUID().slice(0, 8)}`, RAD_CHANNEL);
    scopedToken = await userWith('deployer', labGroup);
    allToken = await userWith('deployer', null);
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [[labGroup, radGroup]]);
    await deleteTestChannel(mods, LAB_CHANNEL);
    await deleteTestChannel(mods, RAD_CHANNEL);
    await mods.pool.end();
  });

  /** One route per channel router, each needing a permission the deployer holds. */
  const ROUTES: readonly (readonly [string, (id: string) => string])[] = [
    ['GET', (id) => `/channels/${id}`],
    ['GET', (id) => `/channels/${id}/messages`],
    ['GET', (id) => `/channels/${id}/messages/1/attachments`],
    ['POST', (id) => `/channels/${id}/messages/1/reprocess`],
    ['GET', (id) => `/channels/${id}/revisions`],
    ['GET', (id) => `/channels/${id}/statistics`],
    ['GET', (id) => `/channels/${id}/status`],
    ['GET', (id) => `/channels/${id}/export`],
    ['GET', (id) => `/channels/${id}/dependencies`],
    ['POST', (id) => `/channels/${id}/stop`],
  ];

  it('answers every channel route outside the scope as not found', async () => {
    for (const [method, path] of ROUTES) {
      const answer = await call(scopedToken, method, path(RAD_CHANNEL));
      expect(answer, `${method} ${path(':id')}`).toEqual({ status: 404, code: 'NOT_FOUND', message: 'Channel not found' });
    }
  });

  it('answers a channel that does not exist exactly as one outside the scope', async () => {
    const answer = await call(scopedToken, 'GET', `/channels/${randomUUID()}`);
    expect(answer).toEqual({ status: 404, code: 'NOT_FOUND', message: 'Channel not found' });
  });

  it('lets the scoped user reach every route on a channel in its group', async () => {
    for (const [method, path] of ROUTES) {
      const answer = await call(scopedToken, method, path(LAB_CHANNEL));
      // Past the guard: not refused (403) and not hidden. What the handler then
      // answers for a bare test channel (200, or 404 for a missing message) is its own.
      expect(answer.status, `${method} ${path(':id')}`).not.toBe(403);
      expect(answer.message, `${method} ${path(':id')}`).not.toBe('Channel not found');
    }
  });

  /** GET `path` as `token` and return the `data` of a success answer. */
  async function data<T>(token: string, path: string): Promise<T> {
    const res = await fetch(`${base}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status, path).toBe(200);
    return ((await res.json()) as { data: T }).data;
  }

  /** The test channels a list names, by the field it keys them on. */
  const ours = (ids: readonly (string | null | undefined)[]): string[] =>
    ids.filter((id): id is string => id === LAB_CHANNEL || id === RAD_CHANNEL).sort();

  it('filters every list to the channels inside the scope (8b)', async () => {
    await mods.pool.query(
      `INSERT INTO events (level, name, outcome, channel_id) VALUES ('INFO', 'ITEST_SCOPE', 'SUCCESS', $1), ('INFO', 'ITEST_SCOPE', 'SUCCESS', $2), ('INFO', 'ITEST_SCOPE', 'SUCCESS', NULL)`,
      [LAB_CHANNEL, RAD_CHANNEL],
    );
    try {
      const lists: readonly (readonly [string, (token: string) => Promise<string[]>])[] = [
        ['channels', async (t) => ours((await data<{ data: { id: string }[] }>(t, '/channels?pageSize=100')).data.map((c) => c.id))],
        ['statistics', async (t) => ours((await data<{ channelId: string }[]>(t, '/channels/statistics')).map((s) => s.channelId))],
        ['memberships', async (t) => ours((await data<{ channelId: string }[]>(t, '/channel-groups/memberships')).map((m) => m.channelId))],
        ['export', async (t) => ours((await data<{ channels: { id: string }[] }>(t, '/channels/export')).channels.map((c) => c.id))],
        ['events', async (t) => ours((await data<{ data: { channelId: string | null }[] }>(t, '/events?name=ITEST_SCOPE&pageSize=100')).data.map((e) => e.channelId))],
      ];
      for (const [name, list] of lists) {
        expect(await list(scopedToken), `${name}, scoped`).toEqual([LAB_CHANNEL]);
        expect(await list(allToken), `${name}, all channels`).toEqual([LAB_CHANNEL, RAD_CHANNEL].sort());
      }
      // A system-wide event (no channel) is for all-channel holders only.
      const scopedEvents = await data<{ data: { channelId: string | null }[] }>(scopedToken, '/events?name=ITEST_SCOPE&pageSize=100');
      expect(scopedEvents.data.some((e) => e.channelId === null)).toBe(false);
    } finally {
      await mods.pool.query(`DELETE FROM events WHERE name = 'ITEST_SCOPE'`);
    }
  });

  it('filters statuses and tag assignments, and hides the channels of another group (8b)', async () => {
    const tag = await mods.pool.query<{ id: string }>('INSERT INTO channel_tags (name) VALUES ($1) RETURNING id', [`itest-scope-${randomUUID().slice(0, 8)}`]);
    const tagId = tag.rows[0]!.id;
    await mods.pool.query('INSERT INTO channel_tag_assignments (tag_id, channel_id) VALUES ($1, $2), ($1, $3)', [tagId, LAB_CHANNEL, RAD_CHANNEL]);
    try {
      const tagged = (t: string): Promise<string[]> => data<{ tagId: string; channelId: string }[]>(t, '/tags/assignments')
        .then((rows) => ours(rows.filter((r) => r.tagId === tagId).map((r) => r.channelId)));
      expect(await tagged(scopedToken)).toEqual([LAB_CHANNEL]);
      expect(await tagged(allToken)).toEqual([LAB_CHANNEL, RAD_CHANNEL].sort());

      const statuses = await data<{ channelId: string }[]>(scopedToken, '/channels/status');
      expect(statuses.some((s) => s.channelId === RAD_CHANNEL)).toBe(false);

      const radGroupSeen = await data<{ channels: { id: string }[]; memberCount: number; outsideScope: number }>(scopedToken, `/channel-groups/${radGroup}`);
      expect(radGroupSeen).toMatchObject({ channels: [], memberCount: 0, outsideScope: 1 });
    } finally {
      await mods.pool.query('DELETE FROM channel_tags WHERE id = $1', [tagId]);
    }
  });

  it('answers an event of another channel, or a system-wide one, as not found when scoped (8b)', async () => {
    const { rows } = await mods.pool.query<{ id: string }>(
      `INSERT INTO events (level, name, outcome, channel_id) VALUES ('INFO', 'ITEST_SCOPE_ONE', 'SUCCESS', $1), ('INFO', 'ITEST_SCOPE_ONE', 'SUCCESS', NULL) RETURNING id`,
      [RAD_CHANNEL],
    );
    try {
      for (const { id } of rows) {
        expect((await call(scopedToken, 'GET', `/events/${id}`)).status, id).toBe(404);
        expect((await call(allToken, 'GET', `/events/${id}`)).status, id).toBe(200);
      }
    } finally {
      await mods.pool.query(`DELETE FROM events WHERE name = 'ITEST_SCOPE_ONE'`);
    }
  });

  it('hides the name of a dependent channel outside the scope (8b)', async () => {
    await mods.pool.query('INSERT INTO channel_dependencies (channel_id, depends_on_channel_id) VALUES ($1, $2)', [RAD_CHANNEL, LAB_CHANNEL]);
    try {
      const dependents = await data<{ channelId: string; channelName: string }[]>(scopedToken, `/channels/${LAB_CHANNEL}/dependents`);
      expect(dependents).toEqual([{ channelId: RAD_CHANNEL, channelName: 'Name unavailable' }]);
    } finally {
      await mods.pool.query('DELETE FROM channel_dependencies WHERE channel_id = $1', [RAD_CHANNEL]);
    }
  });

  it('keeps a dependency on a hidden channel by id but hides its name', async () => {
    await mods.pool.query('INSERT INTO channel_dependencies (channel_id, depends_on_channel_id) VALUES ($1, $2)', [LAB_CHANNEL, RAD_CHANNEL]);
    try {
      const scoped = await data<{ channelId: string; channelName: string }[]>(scopedToken, `/channels/${LAB_CHANNEL}/dependencies`);
      expect(scoped).toEqual([{ channelId: RAD_CHANNEL, channelName: 'Name unavailable' }]);
      const all = await data<{ channelName: string }[]>(allToken, `/channels/${LAB_CHANNEL}/dependencies`);
      expect(all[0]?.channelName).toBe(`itest-${RAD_CHANNEL}`);
    } finally {
      await mods.pool.query('DELETE FROM channel_dependencies WHERE channel_id = $1', [LAB_CHANNEL]);
    }
  });

  it('answers a test run for a channel outside the scope as not found (8c)', async () => {
    const run = (token: string, channelId: string): Promise<Response> => fetch(`${base}/api/v1/scripts/test-run`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'script', sample: '', script: 'return 1;', channelId }),
    });
    const outside = await run(scopedToken, RAD_CHANNEL);
    expect(outside.status).toBe(404);
    expect(((await outside.json()) as { error: { message: string } }).error.message).toBe('Channel not found');
    const inside = await run(scopedToken, LAB_CHANNEL);
    expect(inside.status).toBe(200);
  });

  it('lets an all-channel user reach both channels', async () => {
    for (const id of [LAB_CHANNEL, RAD_CHANNEL]) {
      const answer = await call(allToken, 'GET', `/channels/${id}/statistics`);
      expect(answer.message, id).not.toBe('Channel not found');
    }
  });
});
