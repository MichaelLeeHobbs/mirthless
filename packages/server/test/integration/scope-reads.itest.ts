import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, loadServerModules, userWithRole,
  type ApiAnswer, type ServerModules, type TestUser,
} from './_setup.js';

describeIntegration('system reads and Test Connection under a scope (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const groups: string[] = [];
  const roleIds: string[] = [];
  const newChannels: string[] = [];
  const LAB_CHANNEL = randomUUID();
  const RAD_CHANNEL = randomUUID();
  const USED_CERT = randomUUID();
  const CA_ONLY_CERT = randomUUID();
  let lab: string;
  let scoped: TestUser;
  let alertId: string;
  let tagId: string;

  async function customRole(permissions: readonly string[]): Promise<string> {
    const name = `itest-role-${randomUUID().slice(0, 8)}`;
    const { rows } = await mods.pool.query<{ id: string }>('INSERT INTO roles (name) VALUES ($1) RETURNING id', [name]);
    roleIds.push(rows[0]!.id);
    for (const p of permissions) await mods.pool.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [rows[0]!.id, p]);
    return name;
  }

  const call = <T>(method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> => apiCall<T>(base, scoped.token, method, path, body);

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    lab = await insertTestGroup(mods.pool);
    const rad = await insertTestGroup(mods.pool);
    groups.push(lab, rad);
    await insertTestChannel(mods, LAB_CHANNEL);
    await insertTestChannel(mods, RAD_CHANNEL);
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2), ($3, $4)', [lab, LAB_CHANNEL, rad, RAD_CHANNEL]);
    // By id only: no such certificate needs to exist.
    await mods.pool.query(`UPDATE channels SET source_connector_properties = $2::jsonb WHERE id = $1`, [LAB_CHANNEL, JSON.stringify({ tls: { clientCertId: USED_CERT, caCertId: CA_ONLY_CERT } })]);
    await mods.pool.query('UPDATE channels SET pruning_enabled = true WHERE id = ANY($1::uuid[])', [[LAB_CHANNEL, RAD_CHANNEL]]);

    const alert = await mods.pool.query<{ id: string }>(`INSERT INTO alerts (name, trigger_type) VALUES ($1, 'ERROR') RETURNING id`, [`itest-alert-${randomUUID().slice(0, 8)}`]);
    alertId = alert.rows[0]!.id;
    await mods.pool.query('INSERT INTO alert_channels (alert_id, channel_id) VALUES ($1, $2), ($1, $3)', [alertId, LAB_CHANNEL, RAD_CHANNEL]);
    const tag = await mods.pool.query<{ id: string }>('INSERT INTO channel_tags (name) VALUES ($1) RETURNING id', [`itest-${randomUUID().slice(0, 8)}`]);
    tagId = tag.rows[0]!.id;
    await mods.pool.query('INSERT INTO channel_tag_assignments (tag_id, channel_id) VALUES ($1, $2), ($1, $3)', [tagId, LAB_CHANNEL, RAD_CHANNEL]);

    const role = await customRole(['alerts:read', 'settings:read', 'channels:read', 'channels:write', 'channels:deploy']);
    scoped = await userWithRole(mods.pool, role, [lab]);
    users.push(scoped.id);
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    await mods.pool.query('DELETE FROM alerts WHERE id = $1', [alertId]);
    await mods.pool.query('DELETE FROM channel_tags WHERE id = $1', [tagId]);
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    if (roleIds.length > 0) await mods.pool.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [roleIds]);
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = ANY($1::uuid[])', [[LAB_CHANNEL, RAD_CHANNEL]]);
    for (const id of newChannels) await deleteTestChannel(mods, id);
    await deleteTestChannel(mods, LAB_CHANNEL);
    await deleteTestChannel(mods, RAD_CHANNEL);
    if (groups.length > 0) await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [groups]);
    await mods.pool.end();
  });

  it('shows an alert\'s channels in scope only, with a count of the rest', async () => {
    const one = await call<{ channelIds: string[]; outsideScopeCount: number }>('GET', `/alerts/${alertId}`);
    expect(one.json.data).toMatchObject({ channelIds: [LAB_CHANNEL], outsideScopeCount: 1 });
  });

  it('counts only in-scope channels for a tag, and lists only in-scope pruner and channel statistics', async () => {
    const tags = await call<Array<{ id: string; assignmentCount: number }>>('GET', '/tags');
    expect(tags.json.data!.find((t) => t.id === tagId)?.assignmentCount).toBe(1);
    const pruner = await call<Array<{ channelId: string }>>('GET', '/admin/prune/statistics');
    const prunerIds = pruner.json.data!.map((r) => r.channelId);
    expect(prunerIds).toContain(LAB_CHANNEL);
    expect(prunerIds).not.toContain(RAD_CHANNEL);
    const stats = await call<Array<{ channelId: string }>>('GET', '/channels/statistics');
    const statIds = stats.json.data!.map((r) => r.channelId);
    expect(statIds).toContain(LAB_CHANNEL);
    expect(statIds).not.toContain(RAD_CHANNEL);
  });

  it('makes a scoped deployer\'s Test Connection name an in-scope channel and use only client certificates used in scope', async () => {
    const body = (channelId: string | undefined, tls: Record<string, string>): Record<string, unknown> => ({
      connectorType: 'HTTP', mode: 'DESTINATION', ...(channelId === undefined ? {} : { channelId }),
      properties: { url: 'https://203.0.113.10:9/', method: 'GET', scheme: 'HTTPS', tls },
    });
    const missing = await call('POST', '/connectors/test', body(undefined, { clientCertId: USED_CERT }));
    expect(missing.status).toBe(400);
    expect(missing.json.error?.message).toContain('channelId');
    expect((await call('POST', '/connectors/test', body(RAD_CHANNEL, { clientCertId: USED_CERT }))).status).toBe(404);
    const foreign = await call('POST', '/connectors/test', body(LAB_CHANNEL, { clientCertId: randomUUID() }));
    expect(foreign.status).toBe(403);
    expect(foreign.json.error?.message).toContain('certificate');
    // A certificate Lab pins only as a CA cannot be used for its private key.
    expect((await call('POST', '/connectors/test', body(LAB_CHANNEL, { clientCertId: CA_ONLY_CERT }))).status).toBe(403);
    // Naming any certificate as a CA is harmless, and one Lab already uses as a client passes the scope check;
    // resolving it then fails, since no such certificate is in the store.
    const allowed = await call('POST', '/connectors/test', body(LAB_CHANNEL, { clientCertId: USED_CERT, caCertId: randomUUID() }));
    expect(allowed.status).toBe(400);
    expect(allowed.json.error?.message).toContain('certificate resolution failed');
  });

  it('refuses saving a channel that would use another group\'s certificate key', async () => {
    const revision = async (): Promise<number> => (await mods.pool.query<{ revision: number }>('SELECT revision FROM channels WHERE id = $1', [LAB_CHANNEL])).rows[0]!.revision;
    const refused = await call('PUT', `/channels/${LAB_CHANNEL}`, { revision: await revision(), sourceConnectorProperties: { tls: { clientCertId: randomUUID() } } });
    expect(refused.status).toBe(403);
    const kept = await call('PUT', `/channels/${LAB_CHANNEL}`, { revision: await revision(), sourceConnectorProperties: { tls: { clientCertId: USED_CERT, caCertId: CA_ONLY_CERT } } });
    expect(kept.status).toBe(200);
  });

  it('lets a group-scoped writer save, export, import, clone and test a database connector with TLS on', async () => {
    const database = { vendor: 'postgresql', host: '169.254.169.254', port: 5432, database: 'lab', username: 'svc', password: 'p', tls: true, query: 'SELECT 1' };
    const made = await call<{ id: string; revision: number; name: string }>('POST', '/channels', {
      name: `itest-dbtls-${randomUUID().slice(0, 8)}`, inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: {}, responseMode: 'NONE',
      destinations: [{ name: 'Archive', connectorType: 'DATABASE', properties: database }],
    });
    expect(made.status, JSON.stringify(made.json.error)).toBe(201);
    const { id, revision, name } = made.json.data!;
    newChannels.push(id);

    const saved = await call('PUT', `/channels/${id}`, { revision, destinations: [{ name: 'Archive', connectorType: 'DATABASE', properties: { ...database, query: 'SELECT 2' } }] });
    expect(saved.status, JSON.stringify(saved.json.error)).toBe(200);

    const exported = await call<{ channels: unknown[] }>('GET', `/channels/${id}/export`);
    const imported = await call('POST', '/channels/import', { ...exported.json.data, collisionMode: 'OVERWRITE' });
    expect(imported.json.data).toEqual({ created: 0, updated: 1, skipped: 0, errors: [] });

    const cloned = await call<{ id: string }>('POST', `/channels/${id}/clone`, { name: `${name}-clone` });
    expect(cloned.status, JSON.stringify(cloned.json.error)).toBe(201);
    newChannels.push(cloned.json.data!.id);

    // The test gets as far as refusing the host, which is reserved.
    const tested = await call('POST', '/connectors/test', { connectorType: 'DATABASE', mode: 'DESTINATION', channelId: id, properties: database });
    expect(JSON.stringify(tested.json)).toContain('169.254.169.254');
    expect(JSON.stringify(tested.json)).not.toContain('tls');
  });
});
