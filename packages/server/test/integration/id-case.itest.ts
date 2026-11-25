// Postgres reads a UUID in either case and returns it in lower case; the server compares
// ids as text (#397). Each test sends ids in capitals and expects what the stored id gets.
// The user routes are covered by own-account.itest.ts.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ChannelAccessView, IssuedApiKey } from '@galvanigraph/core-models';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, describeIntegration, insertTestGroup, loadServerModules, unwrap, userWithRole, type ApiAnswer, type ServerModules, type TestUser,
} from './_setup.js';

const caps = (id: string): string => id.toUpperCase();

describeIntegration('ids sent in capitals (real Postgres, real engine)', () => {
  let mods: ServerModules;
  let engineMod: typeof import('../../src/engine.js');
  let deployment: typeof import('../../src/services/deployment.service.js');
  let server: Server;
  let base: string;
  let admin: TestUser;
  let lab: string;
  let labViewer: TestUser;
  const users: string[] = [];
  const groups: string[] = [];
  const roles: string[] = [];
  const channelIds: string[] = [];
  const libraries: string[] = [];
  const alerts: string[] = [];

  const call = <T>(method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> => apiCall<T>(base, admin.token, method, path, body);

  async function user(role: string | null, groupIds: readonly string[] | null): Promise<TestUser> {
    const made = await userWithRole(mods.pool, role, groupIds);
    users.push(made.id);
    return made;
  }

  async function group(): Promise<string> {
    const id = await insertTestGroup(mods.pool);
    groups.push(id);
    return id;
  }

  const channelBody = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: `itest-397-${randomUUID().slice(0, 8)}`, enabled: true, inboundDataType: 'RAW', outboundDataType: 'RAW',
    sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
    responseMode: 'NONE', properties: { initialState: 'STARTED' }, ...extra,
  });

  async function channel(extra: Record<string, unknown> = {}): Promise<string> {
    const made = await call<{ id: string }>('POST', '/channels', channelBody(extra));
    expect(made.status).toBe(201);
    channelIds.push(made.json.data!.id);
    return made.json.data!.id;
  }

  async function deployed(): Promise<string> {
    const id = await channel();
    expect((await call('POST', `/channels/${id}/deploy`)).status).toBe(200);
    return id;
  }

  async function role(permissions: readonly string[]): Promise<{ readonly id: string; readonly name: string }> {
    const name = `itest-397-${randomUUID().slice(0, 8)}`;
    const made = await call<{ id: string }>('POST', '/roles', { name, permissions });
    expect(made.status).toBe(201);
    roles.push(made.json.data!.id);
    return { id: made.json.data!.id, name };
  }

  /** The audit rows are stamped with the database's clock, not this process's. */
  async function accessNow(channelId: string): Promise<ChannelAccessView['people']> {
    const { rows } = await mods.pool.query<{ t: Date }>('SELECT clock_timestamp() AS t');
    const res = await call<ChannelAccessView>('GET', `/channels/${channelId}/access?asOf=${encodeURIComponent(rows[0]!.t.toISOString())}`);
    expect(res.status).toBe(200);
    return res.json.data!.people;
  }

  async function recordedGroups(channelId: string): Promise<readonly string[][]> {
    const { rows } = await mods.pool.query<{ after: string[] }>(
      `SELECT attributes->'after' AS after FROM audit_log WHERE action = 'CHANNEL_GROUPS_CHANGED' AND channel_id = $1 ORDER BY id`, [channelId],
    );
    return rows.map((r) => r.after);
  }

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    process.env['API_KEY_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    engineMod = await import('../../src/engine.js');
    deployment = await import('../../src/services/deployment.service.js');
    lab = await group();
    admin = await user('admin', null);
    labViewer = await user('channel-viewer', [lab]);
    // The rows above went in directly, so the replay starts from a baseline after them.
    await mods.pool.query(`SELECT public.record_grant_baseline('id-case itest')`);
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    for (const id of channelIds) {
      if (engineMod.getEngine().getRuntime(id) === undefined) continue;
      await deployment.DeploymentService.stop(id);
      await deployment.DeploymentService.undeploy(id);
    }
    await engineMod?.getEngine().dispose();
    if (alerts.length > 0) await mods.pool.query('DELETE FROM alerts WHERE id = ANY($1::uuid[])', [alerts]);
    if (libraries.length > 0) await mods.pool.query('DELETE FROM code_template_libraries WHERE id = ANY($1::uuid[])', [libraries]);
    await mods.pool.query('DELETE FROM channel_dependencies WHERE channel_id = ANY($1::uuid[])', [channelIds]);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = ANY($1::uuid[])', [channelIds]);
    await mods.pool.query('UPDATE channels SET deleted_at = now() WHERE id = ANY($1::uuid[])', [channelIds]);
    await mods.pool.query('DELETE FROM users WHERE id IN (SELECT user_id FROM api_keys WHERE issued_by = ANY($1::uuid[]))', [users]);
    await mods.pool.query('DELETE FROM roles WHERE key_role AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.role_id = roles.id)');
    await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await mods.pool.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [roles]);
    await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [groups]);
    await mods.pool.end();
  });

  it('refuses to delete a deployed channel, and leaves it there and running', async () => {
    const id = await deployed();

    const answer = await call('DELETE', `/channels/${caps(id)}`);

    expect(answer.status).toBe(409);
    expect(engineMod.getEngine().getRuntime(id)?.runtime.getState()).toBe('STARTED');
    expect((await call('GET', `/channels/${id}`)).status).toBe(200);
  });

  it('stops, undeploys and redeploys a deployed channel', async () => {
    const id = await deployed();
    const state = async (): Promise<string | undefined> => (await call<{ state: string }>('GET', `/channels/${caps(id)}/status`)).json.data?.state;

    expect(await state()).toBe('STARTED');
    expect((await call('POST', `/channels/${caps(id)}/redeploy`)).status).toBe(200);
    expect((await call('POST', `/channels/${caps(id)}/stop`)).status).toBe(200);
    expect(await state()).toBe('STOPPED');
    expect((await call('POST', `/channels/${caps(id)}/undeploy`)).status).toBe(200);
    expect(engineMod.getEngine().getRuntime(id)).toBeUndefined();
  });

  it('saves a role under the name it has', async () => {
    const { id, name } = await role(['channels:read']);

    expect((await call('PUT', `/roles/${caps(id)}`, { name, description: 'edited' })).status).toBe(200);
  });

  it('answers a change of a role\'s permissions, and past access shows it for the role\'s holders', async () => {
    const id = await channel({ groupId: lab });
    const { id: roleId } = await role(['channels:read', 'messages:read']);
    const holder = await user(null, null);
    expect((await call('PUT', `/users/${holder.id}/assignments`, { assignments: [{ roleId, groupIds: [lab] }] })).status).toBe(200);

    const edited = await call<{ id: string }>('PUT', `/roles/${caps(roleId)}`, { permissions: ['channels:read'] });

    expect.soft(edited.status).toBe(200);
    expect.soft(edited.json.data?.id).toBe(roleId);
    expect((await accessNow(id)).find((p) => p.userId === holder.id)?.permissions).toEqual(['channels:read']);
  });

  it('reads and deletes a role', async () => {
    const { id } = await role(['channels:read']);

    expect((await call('GET', `/roles/${caps(id)}`)).status).toBe(200);
    expect((await call('DELETE', `/roles/${caps(id)}`)).status).toBe(204);
    const { rows } = await mods.pool.query(`SELECT 1 FROM audit_log WHERE action = 'ROLE_DELETED' AND attributes->>'roleId' = $1`, [id]);
    expect(rows).toHaveLength(1);
  });

  it.each(['leak', 'planned'])('gives a key a new token that signs in (%s)', async (mode) => {
    const id = await channel();
    const issued = await call<IssuedApiKey>('POST', '/api-keys', {
      name: `k-${randomUUID().slice(0, 6)}`, permissions: ['channels:read'], groupIds: null, expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(issued.status).toBe(201);

    const replaced = await call<IssuedApiKey>('POST', `/api-keys/${caps(issued.json.data!.key.id)}/replace`, { mode });

    expect(replaced.status).toBe(201);
    expect((await apiCall(base, replaced.json.data!.token, 'GET', `/channels/${id}`)).status).toBe(200);
  });

  it.each([
    ['a create', async () => channel({ groupId: caps(lab) })],
    ['a clone', async () => {
      const source = await channel();
      const made = await call<{ id: string }>('POST', `/channels/${caps(source)}/clone`, { name: `itest-397-${randomUUID().slice(0, 8)}`, groupId: caps(lab) });
      expect(made.status).toBe(201);
      channelIds.push(made.json.data!.id);
      return made.json.data!.id;
    }],
    ['an import', async () => {
      const source = await channel();
      const id = randomUUID();
      channelIds.push(id);
      const file = await call<{ channels: Array<Record<string, unknown>> }>('GET', `/channels/${caps(source)}/export`);
      const entry = { ...file.json.data!.channels[0], id: caps(id), name: `itest-397-${randomUUID().slice(0, 8)}` };
      const done = await call('POST', '/channels/import', { version: 1, exportedAt: new Date().toISOString(), channels: [entry], collisionMode: 'SKIP', groupId: caps(lab) });
      expect(done.json.data).toMatchObject({ created: 1, errors: [] });
      return id;
    }],
    ['a Mirth import', async () => {
      const id = randomUUID();
      channelIds.push(id);
      const xml = `<channel version="4.5.0"><id>${caps(id)}</id><name>itest-397-${randomUUID().slice(0, 8)}</name></channel>`;
      const done = await call<{ importResult: unknown }>('POST', '/channels/import/mirth', { xml, collisionMode: 'SKIP', groupId: caps(lab) });
      expect(done.json.data?.importResult).toMatchObject({ created: 1, errors: [] });
      return id;
    }],
  ] as const)('records the group a channel joins by %s as stored, so its people show in past access', async (_how, make) => {
    const id = await make();

    expect(await recordedGroups(id)).toEqual([[lab]]);
    expect((await accessNow(id)).map((p) => p.userId)).toContain(labViewer.id);
  });

  it('shows scoped people in past access when the channel\'s id is in capitals', async () => {
    const id = await channel({ groupId: lab });

    expect((await accessNow(caps(id))).map((p) => p.userId)).toContain(labViewer.id);
  });

  it('records that a deleted group is no longer joined', async () => {
    const doomed = await group();
    const id = await channel({ groupId: doomed });

    expect((await call('DELETE', `/channel-groups/${caps(doomed)}`)).status).toBeLessThan(300);

    expect(await recordedGroups(id)).toEqual([[doomed], []]);
  });

  it('refuses one group twice, in two spellings, in an assignment and in a key', async () => {
    const holder = await user(null, null);
    const { id: roleId } = await role(['channels:read']);
    const groupIds = [lab, caps(lab)];

    expect((await call('PUT', `/users/${holder.id}/assignments`, { assignments: [{ roleId, groupIds }] })).status).toBe(400);
    expect((await call('POST', '/api-keys', {
      name: `k-${randomUUID().slice(0, 6)}`, permissions: ['channels:read'], groupIds, expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    })).status).toBe(400);
  });

  it('assigns a role over a group, and past access shows it', async () => {
    const { id: reader } = await role(['channels:read']);
    const target = await user(null, null);

    const given = await call('PUT', `/users/${caps(target.id)}/assignments`, { assignments: [{ roleId: caps(reader), groupIds: [caps(lab)] }] });

    expect(given.status).toBe(200);
    const id = await channel({ groupId: lab });
    expect((await accessNow(id)).map((p) => p.userId)).toContain(target.id);
  });

  it('refuses a channel that depends on itself, or on one that depends on it', async () => {
    const first = await channel();
    const second = await channel();

    expect((await call('PUT', `/channels/${first}/dependencies`, { dependsOnChannelIds: [caps(first)] })).status).toBe(400);
    expect((await call('PUT', `/channels/${second}/dependencies`, { dependsOnChannelIds: [first] })).status).toBe(200);
    expect((await call('PUT', `/channels/${first}/dependencies`, { dependsOnChannelIds: [caps(second)] })).status).toBe(400);
    expect((await call('PUT', `/channels/${caps(first)}/dependencies`, { dependsOnChannelIds: [second] })).status).toBe(400);
  });

  it('gives a channel the templates of a library linked to it', async () => {
    const id = await channel({ scripts: { deploy: 'itest397();' } });
    const library = await call<{ id: string; channelIds: string[] }>('POST', '/code-templates/libraries', { name: `itest-397-${randomUUID().slice(0, 8)}`, channelIds: [caps(id)] });
    expect(library.status).toBe(201);
    libraries.push(library.json.data!.id);
    expect((await call('POST', '/code-templates', {
      libraryId: caps(library.json.data!.id), name: 'itest397', type: 'FUNCTION', code: 'function itest397() { return 1; }', contexts: ['CHANNEL_DEPLOY'],
    })).status).toBe(201);

    const bundle = unwrap(await (await import('../../src/services/deployment-record.service.js')).DeploymentRecordService.loadSaved(id));

    expect(bundle.templates.map((t) => t.name)).toContain('itest397');
  });

  it('stores the channel an alert sends to as the engine looks it up', async () => {
    const id = await channel();
    const made = await call<{ id: string; actions: Array<{ properties: { channelId?: string } | null }> }>('POST', '/alerts', {
      name: `itest-397-${randomUUID().slice(0, 8)}`, trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'] },
      actions: [{ type: 'CHANNEL', channelId: caps(id) }],
    });
    expect(made.status).toBe(201);
    alerts.push(made.json.data!.id);

    expect(made.json.data!.actions.map((a) => a.properties?.channelId)).toEqual([id]);
  });
});
