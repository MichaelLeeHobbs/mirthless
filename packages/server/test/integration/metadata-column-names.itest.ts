// A channel's metadata columns are one per name (a unique index); two of one name answered 500 (#450).

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, closeServer, describeIntegration, listen, loadServerModules, userWithRole,
  type ApiAnswer, type ServerModules, type TestUser,
} from './_setup.js';

const COLUMN = { name: 'PatientId', dataType: 'STRING', mappingExpression: null };
const TWICE = [COLUMN, { ...COLUMN, dataType: 'NUMBER' }];

describeIntegration('two metadata columns of one name (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  let admin: TestUser;
  const channelIds: string[] = [];

  const call = <T>(method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> => apiCall<T>(base, admin.token, method, path, body);
  const fresh = (): string => `itest-450-${randomUUID().slice(0, 8)}`;
  const channel = (name: string, metadataColumns: unknown): Record<string, unknown> => ({
    name, inboundDataType: 'RAW', outboundDataType: 'RAW', responseMode: 'NONE', sourceConnectorType: 'CHANNEL', sourceConnectorProperties: {}, metadataColumns,
  });

  async function columnsOf(id: string): Promise<string[]> {
    const { rows } = await mods.pool.query<{ name: string }>('SELECT name FROM channel_metadata_columns WHERE channel_id = $1 ORDER BY name', [id]);
    return rows.map((r) => r.name);
  }

  async function named(name: string): Promise<number> {
    const { rows } = await mods.pool.query<{ n: string }>('SELECT count(*) AS n FROM channels WHERE name = $1', [name]);
    return Number(rows[0]!.n);
  }

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    admin = await userWithRole(mods.pool, 'admin', null);
    const app = (await import('../../src/app.js')).default;
    ({ server, base } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
    if (channelIds.length > 0) {
      await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = ANY($1::uuid[])', [channelIds]);
      await mods.pool.query('UPDATE channels SET deleted_at = now() WHERE id = ANY($1::uuid[])', [channelIds]);
    }
    await mods.pool.query('DELETE FROM users WHERE id = $1', [admin.id]);
    await mods.pool.end();
  });

  it('answers 400 naming the column to a create, and makes no channel', async () => {
    const name = fresh();

    const answer = await call('POST', '/channels', channel(name, TWICE));

    expect(answer.status).toBe(400);
    expect(answer.json.error?.code).toBe('VALIDATION_ERROR');
    expect(answer.json.error?.message).toContain('Two metadata columns are named "PatientId"');
    expect(await named(name)).toBe(0);
  });

  it('answers 400 naming the column to an update, and keeps the columns stored', async () => {
    const made = await call<{ readonly id: string; readonly revision: number }>('POST', '/channels', channel(fresh(), [COLUMN, { ...COLUMN, name: 'OrderDate' }]));
    expect(made.status).toBe(201);
    channelIds.push(made.json.data!.id);

    const answer = await call('PUT', `/channels/${made.json.data!.id}`, { revision: made.json.data!.revision, metadataColumns: TWICE });

    expect(answer.status).toBe(400);
    expect(answer.json.error?.message).toContain('Two metadata columns are named "PatientId"');
    expect(await columnsOf(made.json.data!.id)).toEqual(['OrderDate', 'PatientId']);
  });

  it('answers 400 naming the channel and the column to an import, and imports nothing', async () => {
    const id = randomUUID();
    const name = fresh();
    const entry = {
      id, name, description: '', enabled: false, revision: 1, inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'CHANNEL', sourceConnectorProperties: {}, responseMode: 'NONE', responseConnectorName: null,
      initialState: 'STOPPED', messageStorageMode: 'DEVELOPMENT', encryptData: false, removeContentOnCompletion: false,
      removeAttachmentsOnCompletion: false, pruningEnabled: false, pruningMaxAgeDays: null, pruningArchiveEnabled: false,
      scripts: [], destinations: [], metadataColumns: TWICE, filters: [], transformers: [],
    };

    const answer = await call('POST', '/channels/import', { version: 1, exportedAt: new Date().toISOString(), channels: [entry], collisionMode: 'SKIP' });

    expect(answer.status).toBe(400);
    expect(answer.json.error?.message).toContain(`Channel "${name}": two metadata columns are named "PatientId"`);
    expect(await named(name)).toBe(0);
  });
});
