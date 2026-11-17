// ===========================================
// New channels land in the creator's scope (real Postgres, #266 slice 9b)
// ===========================================
// Create, clone and JSON import (which Mirth import runs through) put the new channel in a group
// inside the creator's channels:write scope, in the creating transaction: a
// scoped writer's channel would otherwise be in no group and out of their own
// reach. Import OVERWRITE needs channels:write on each channel it replaces.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeIntegration, loadServerModules, type ServerModules } from './_setup.js';

describeIntegration('new channels land in the creator\'s scope (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const groups: string[] = [];
  const channelIds: string[] = [];

  async function userWith(role: string, groupIds: readonly string[] | null): Promise<{ id: string; token: string }> {
    const { signAccessToken } = await import('../../src/lib/jwt.js');
    const name = `itest-cis-${randomUUID().slice(0, 8)}`;
    const { rows } = await mods.pool.query<{ id: string }>(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'not-a-hash') RETURNING id`, [name, `${name}@example.test`],
    );
    const id = rows[0]!.id;
    users.push(id);
    for (const groupId of groupIds ?? [null]) {
      const assigned = await mods.pool.query<{ id: string }>(
        `INSERT INTO assignments (user_id, role_id, all_channels) SELECT $1, id, $3 FROM roles WHERE name = $2 RETURNING id`,
        [id, role, groupId === null],
      );
      if (groupId !== null) await mods.pool.query('INSERT INTO assignment_groups (assignment_id, channel_group_id) VALUES ($1, $2)', [assigned.rows[0]!.id, groupId]);
    }
    const session = await mods.pool.query<{ id: string }>(
      `INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, now() + interval '1 hour') RETURNING id`, [id, `itest-${randomUUID()}`],
    );
    return { id, token: signAccessToken({ userId: id, sessionId: session.rows[0]!.id }) };
  }

  async function group(): Promise<string> {
    const { rows } = await mods.pool.query<{ id: string }>('INSERT INTO channel_groups (name) VALUES ($1) RETURNING id', [`itest-cis-${randomUUID().slice(0, 8)}`]);
    groups.push(rows[0]!.id);
    return rows[0]!.id;
  }

  async function call(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: { data?: { id?: string; created?: number; updated?: number; errors?: string[] }; error?: { code?: string } } }> {
    const res = await fetch(`${base}/api/v1${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, json: await res.json() as never };
  }

  async function groupsOf(channelId: string): Promise<string[]> {
    const { rows } = await mods.pool.query<{ id: string }>('SELECT channel_group_id AS id FROM channel_group_members WHERE channel_id = $1 ORDER BY 1', [channelId]);
    return rows.map((r) => r.id);
  }

  const newChannel = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: `itest-cis-${randomUUID().slice(0, 8)}`, inboundDataType: 'RAW', outboundDataType: 'RAW',
    sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: {}, responseMode: 'NONE', ...extra,
  });

  async function create(token: string, extra: Record<string, unknown> = {}): Promise<{ status: number; id: string | undefined }> {
    const res = await call(token, 'POST', '/channels', newChannel(extra));
    const id = res.json.data?.id;
    if (id) channelIds.push(id);
    return { status: res.status, id };
  }

  /** A JSON export entry for a plain channel with this id. */
  const entry = (id: string, name: string): Record<string, unknown> => ({
    id, name, description: '', enabled: false, revision: 1, inboundDataType: 'RAW', outboundDataType: 'RAW',
    sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: {}, responseMode: 'NONE', responseConnectorName: null,
    initialState: 'STOPPED', messageStorageMode: 'DEVELOPMENT', encryptData: false, removeContentOnCompletion: false,
    removeAttachmentsOnCompletion: false, pruningEnabled: false, pruningMaxAgeDays: null, pruningArchiveEnabled: false,
    scripts: [], destinations: [], metadataColumns: [], filters: [], transformers: [],
  });

  const importBody = (entries: ReadonlyArray<Record<string, unknown>>, collisionMode: string, groupId?: string): Record<string, unknown> => ({
    version: 1, exportedAt: new Date().toISOString(), channels: entries, collisionMode, ...(groupId ? { groupId } : {}),
  });

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    if (channelIds.length > 0) {
      await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = ANY($1::uuid[])', [channelIds]);
      await mods.pool.query('UPDATE channels SET deleted_at = now() WHERE id = ANY($1::uuid[])', [channelIds]);
    }
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    if (groups.length > 0) await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [groups]);
    await mods.pool.end();
  });

  it('puts a scoped writer\'s new channel in their one write group, recorded in the audit log', async () => {
    const lab = await group();
    const writer = await userWith('channel-developer', [lab]);
    const made = await create(writer.token);
    expect(made.status).toBe(201);
    expect(await groupsOf(made.id!)).toEqual([lab]);
    const { rows } = await mods.pool.query<{ attributes: { before: string[]; after: string[] } }>(
      `SELECT attributes FROM audit_log WHERE action = 'CHANNEL_GROUPS_CHANGED' AND channel_id = $1`, [made.id],
    );
    expect(rows.map((r) => r.attributes)).toEqual([{ before: [], after: [lab], created: true }]);
    // The writer can open what they made.
    expect((await call(writer.token, 'GET', `/channels/${made.id!}`)).status).toBe(200);
  });

  it('makes a writer scoped to several groups choose one inside their scope', async () => {
    const lab = await group();
    const rad = await group();
    const outside = await group();
    const writer = await userWith('channel-developer', [lab, rad]);
    expect((await create(writer.token)).status).toBe(400);
    expect((await create(writer.token, { groupId: outside })).status).toBe(403);
    const made = await create(writer.token, { groupId: rad });
    expect(made.status).toBe(201);
    expect(await groupsOf(made.id!)).toEqual([rad]);
  });

  it('puts an all-channel writer\'s channel in Default, or in the group they name', async () => {
    const lab = await group();
    const developer = await userWith('developer', null);
    // The seed makes Default; a database migrated without the seed (CI) has none.
    const made = await mods.pool.query<{ id: string }>(`INSERT INTO channel_groups (name) SELECT 'Default' WHERE NOT EXISTS (SELECT 1 FROM channel_groups WHERE name = 'Default') RETURNING id`);
    groups.push(...made.rows.map((r) => r.id));
    const { rows } = await mods.pool.query<{ id: string }>(`SELECT id FROM channel_groups WHERE name = 'Default'`);
    expect(rows).toHaveLength(1);
    const plain = await create(developer.token);
    expect(await groupsOf(plain.id!)).toEqual([rows[0]!.id]);
    const named = await create(developer.token, { groupId: lab });
    expect(await groupsOf(named.id!)).toEqual([lab]);
    expect((await create(developer.token, { groupId: randomUUID() })).status).toBe(404);
  });

  it('puts a scoped writer\'s clone in their write group', async () => {
    const lab = await group();
    const writer = await userWith('channel-developer', [lab]);
    const source = await create(writer.token);
    const res = await call(writer.token, 'POST', `/channels/${source.id!}/clone`, { name: `itest-cis-${randomUUID().slice(0, 8)}` });
    expect(res.status).toBe(201);
    channelIds.push(res.json.data!.id!);
    expect(await groupsOf(res.json.data!.id!)).toEqual([lab]);
  });

  it('puts imported channels in scope and refuses to overwrite a channel outside it', async () => {
    const lab = await group();
    const writer = await userWith('channel-developer', [lab]);
    const admin = await userWith('admin', null);
    const outside = await create(admin.token, { groupId: await group() });
    const mine = await create(writer.token);

    const freshId = randomUUID();
    channelIds.push(freshId);
    const created = await call(writer.token, 'POST', '/channels/import', importBody([entry(freshId, `itest-cis-${randomUUID().slice(0, 8)}`)], 'SKIP'));
    expect(created.json.data).toMatchObject({ created: 1, errors: [] });
    expect(await groupsOf(freshId)).toEqual([lab]);

    const renamed = `itest-cis-renamed-${randomUUID().slice(0, 8)}`;
    const overwrite = await call(writer.token, 'POST', '/channels/import', importBody([
      entry(outside.id!, renamed), entry(mine.id!, `${renamed}-mine`),
    ], 'OVERWRITE'));
    expect(overwrite.json.data?.updated).toBe(1);
    expect(overwrite.json.data?.errors).toEqual([`Channel "${renamed}": not imported; it would replace a channel you cannot change`]);
    const { rows } = await mods.pool.query<{ id: string; name: string }>('SELECT id, name FROM channels WHERE id = ANY($1::uuid[])', [[outside.id, mine.id]]);
    expect(rows.find((r) => r.id === outside.id)?.name).not.toBe(renamed);
    expect(rows.find((r) => r.id === mine.id)?.name).toBe(`${renamed}-mine`);
  });

  it('refuses a whole import whose group the importer cannot use, before any channel', async () => {
    const lab = await group();
    const writer = await userWith('channel-developer', [lab]);
    const id = randomUUID();
    const res = await call(writer.token, 'POST', '/channels/import', importBody([entry(id, `itest-cis-${randomUUID().slice(0, 8)}`)], 'SKIP', await group()));
    expect(res.status).toBe(403);
    const { rows } = await mods.pool.query('SELECT 1 FROM channels WHERE id = $1', [id]);
    expect(rows).toHaveLength(0);
  });
});
