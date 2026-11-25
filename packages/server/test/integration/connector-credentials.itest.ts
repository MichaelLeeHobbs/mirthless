// Connector credentials go unmasked only to someone who may change that
// channel (D-346).

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createChannelSchema, updateChannelSchema } from '@galvanigraph/core-models';
import { adminActor, apiCall, describeIntegration, insertTestGroup, loadServerModules, unwrap, userWithRole, type ServerModules, type TestActor, type TestUser } from './_setup.js';

describeIntegration('who reads connector credentials (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  let actor: TestActor;
  let id: string;
  let revision: number;
  let here: string;
  let elsewhere: string;
  const channels: string[] = [];
  const users: string[] = [];
  const groups: string[] = [];
  const roles: string[] = [];

  /** Every credential the channel holds, each text its own. */
  const SECRETS = [
    'S-source-password', 'S-basic-password', 'S-text-header', 'S-url-password', 'S-query-token',
    'S-fhir-header', 'S-fhir-password', 'S-keystore', 'S-truststore',
  ];

  async function user(role: string, groupIds: readonly string[] | null): Promise<TestUser> {
    const made = await userWithRole(mods.pool, role, groupIds);
    users.push(made.id);
    return made;
  }

  async function alsoHolds(userId: string, role: string, groupId: string): Promise<void> {
    const { rows } = await mods.pool.query<{ id: string }>(
      'INSERT INTO assignments (user_id, role_id, all_channels) SELECT $1, id, false FROM roles WHERE name = $2 RETURNING id', [userId, role],
    );
    await mods.pool.query('INSERT INTO assignment_groups (assignment_id, channel_group_id) VALUES ($1, $2)', [rows[0]!.id, groupId]);
  }

  async function roleHolding(...permissions: readonly string[]): Promise<string> {
    const name = `itest-credentials-${randomUUID().slice(0, 8)}`;
    const { rows } = await mods.pool.query<{ id: string }>('INSERT INTO roles (name) VALUES ($1) RETURNING id', [name]);
    roles.push(name);
    for (const p of permissions) await mods.pool.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [rows[0]!.id, p]);
    return name;
  }

  async function shown(token: string, path: string): Promise<readonly string[]> {
    const answer = await apiCall(base, token, 'GET', path);
    expect(answer.status, path).toBe(200);
    const text = JSON.stringify(answer.json);
    expect(text, `${path} holds the channel`).toContain('host.example');
    return SECRETS.filter((secret) => text.includes(secret));
  }

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    users.push(actor.userId);
    here = await insertTestGroup(mods.pool);
    elsewhere = await insertTestGroup(mods.pool);
    groups.push(here, elsewhere);
    const made = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
      name: `itest-credentials-${randomUUID()}`, enabled: false, inboundDataType: 'RAW', outboundDataType: 'RAW', responseMode: 'NONE',
      sourceConnectorType: 'HTTP', sourceConnectorProperties: { port: 18_081, auth: { type: 'BASIC', username: 'lab', password: 'S-source-password' } },
      destinations: [
        { name: 'H', connectorType: 'HTTP', properties: {
          url: 'https://svc:S-url-password@host.example/in?token=S-query-token',
          headers: 'Accept: text/plain\nAuthorization: Bearer S-text-header',
          basicAuth: { username: 'svc', password: 'S-basic-password' },
        } },
        { name: 'F', connectorType: 'FHIR', properties: { baseUrl: 'https://svc:S-fhir-password@host.example/r4', headers: 'X-Api-Key: S-fhir-header' } },
        { name: 'D', connectorType: 'DICOM', properties: { host: 'host.example', port: 104, keyStorePW: 'S-keystore', trustStorePW: 'S-truststore' } },
      ],
    }), actor));
    id = made.id;
    channels.push(id);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = $1', [id]);
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2)', [here, id]);
    const saved = unwrap(await mods.ChannelService.update(id, updateChannelSchema.parse({ revision: made.revision, description: 'saved' }), actor));
    revision = saved.revision;
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    // A save records its revision after it answers.
    const writer = await user('developer', null);
    await vi.waitFor(async () => {
      expect((await apiCall(base, writer.token, 'GET', `/channels/${id}/revisions/${String(revision)}`)).status).toBe(200);
    }, 20_000);
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    if (channels.length > 0) await mods.pool.query('DELETE FROM channels WHERE id = ANY($1::uuid[])', [channels]);
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    if (roles.length > 0) await mods.pool.query('DELETE FROM roles WHERE name = ANY($1)', [roles]);
    if (groups.length > 0) await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [groups]);
    await mods?.pool.end();
  });

  const reads = (): readonly string[] => [`/channels/${id}`, `/channels/${id}/revisions/${String(revision)}`];

  it('shows a viewer none of them, in the channel, its revision or an export', async () => {
    const viewer = await user('viewer', null);
    for (const path of [...reads(), `/channels/${id}/export`, '/channels/export']) expect(await shown(viewer.token, path), path).toEqual([]);
  });

  it('shows someone who may change the channel all of them', async () => {
    for (const writer of [await user('developer', null), await user('channel-developer', [here])]) {
      for (const path of reads()) expect(await shown(writer.token, path), path).toEqual(SECRETS);
    }
  });

  it('shows someone who may change other channels, and only read this one, none of them', async () => {
    const mixed = await user('channel-developer', [elsewhere]);
    await alsoHolds(mixed.id, 'channel-viewer', here);
    for (const path of reads()) expect(await shown(mixed.token, path), path).toEqual([]);
    expect((await apiCall(base, mixed.token, 'PUT', `/channels/${id}`, { revision, description: 'x' })).status).toBe(404);
  });

  it('shows none of them to whoever enables or disables the channel', async () => {
    const deployer = await user(await roleHolding('channels:read', 'channels:deploy'), [here]);
    for (const token of [deployer.token, (await user('admin', null)).token]) {
      const answer = await apiCall<{ id: string; enabled: boolean }>(base, token, 'PATCH', `/channels/${id}/enabled`, { enabled: false });
      expect(answer.status).toBe(200);
      expect(answer.json.data).toMatchObject({ id, enabled: false });
      expect(SECRETS.filter((secret) => JSON.stringify(answer.json).includes(secret))).toEqual([]);
    }
  });

  it('shows none of them in the answer to a save, a new channel or a clone', async () => {
    const writer = await user('developer', null);
    const { json } = await apiCall<{ revision: number; sourceConnectorProperties: unknown }>(base, writer.token, 'GET', `/channels/${id}`);
    const saved = await apiCall<{ revision: number }>(base, writer.token, 'PUT', `/channels/${id}`, { revision: json.data!.revision, description: 'again' });
    expect(saved.status).toBe(200);
    const made = await apiCall<{ id: string }>(base, writer.token, 'POST', '/channels', {
      name: `itest-credentials-${randomUUID()}`, inboundDataType: 'RAW', outboundDataType: 'RAW', responseMode: 'NONE',
      sourceConnectorType: 'HTTP', sourceConnectorProperties: json.data!.sourceConnectorProperties,
    });
    expect(made.status).toBe(201);
    channels.push(made.json.data!.id);
    const clone = await apiCall<{ id: string }>(base, writer.token, 'POST', `/channels/${id}/clone`, { name: `itest-credentials-${randomUUID()}` });
    expect(clone.status).toBe(201);
    channels.push(clone.json.data!.id);
    for (const answer of [saved, made, clone]) {
      expect(SECRETS.filter((secret) => JSON.stringify(answer.json).includes(secret))).toEqual([]);
    }
    expect(await shown(writer.token, `/channels/${clone.json.data!.id}`)).toEqual(SECRETS);
  });

  it('refuses a save or a new channel that would store the mask, and changes nothing', async () => {
    interface Detail { readonly name: string; readonly revision: number; readonly sourceConnectorProperties: unknown; readonly destinations: unknown }
    const reader = await user('viewer', null);
    const writer = await user('developer', null);
    const masked = (await apiCall<Detail>(base, reader.token, 'GET', `/channels/${id}`)).json.data!;
    const put = async (changes: Record<string, unknown>): Promise<void> => {
      const answer = await apiCall(base, writer.token, 'PUT', `/channels/${id}`, { revision: masked.revision, ...changes });
      expect(answer.status).toBe(400);
      expect(answer.json.error?.message).toContain('__REDACTED__');
    };
    await put({ sourceConnectorProperties: masked.sourceConnectorProperties });
    await put({ destinations: masked.destinations });
    const made = await apiCall(base, writer.token, 'POST', '/channels', {
      name: `itest-credentials-${randomUUID()}`, inboundDataType: 'RAW', outboundDataType: 'RAW', responseMode: 'NONE',
      sourceConnectorType: 'HTTP', sourceConnectorProperties: masked.sourceConnectorProperties,
    });
    expect(made.status).toBe(400);
    expect(await shown(writer.token, `/channels/${id}`)).toEqual(SECRETS);
  });

  it('records an unmasked read, and no masked one', async () => {
    const writer = await user('channel-developer', [here]);
    const reader = await user('channel-viewer', [here]);
    const recorded = async (userId: string): Promise<number> => (await mods.pool.query(
      `SELECT 1 FROM audit_log WHERE action = 'CHANNEL_SECRETS_READ' AND user_id = $1`, [userId],
    )).rowCount ?? 0;
    for (const path of reads()) {
      await apiCall(base, reader.token, 'GET', path);
      await apiCall(base, writer.token, 'GET', path);
    }
    await expect.poll(() => recorded(writer.id), { timeout: 10_000 }).toBe(2);
    expect(await recorded(reader.id)).toBe(0);
  });
});
