// An export masks credentials. Importing it with OVERWRITE keeps the stored
// ones only for a connector that still goes to the same place as the same user
// (#334, D-335).

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { channelExportSchema, createChannelSchema, serverBackupSchema, type ChannelExportEntry, type CollisionMode, type ImportResult } from '@galvanigraph/core-models';
import { adminActor, describeIntegration, insertTestGroup, loadServerModules, unwrap, userWithRole, waitForBlocked, type ServerModules, type TestActor } from './_setup.js';

type Properties = Record<string, unknown>;

interface Stored {
  readonly source: Properties;
  readonly destinations: ReadonlyMap<number, Properties>;
}

const SECRETS = ['source-secret', 'database-secret', 'header-secret', 'basic-secret'];

const SOURCE = { port: 18_081, path: '/in', scheme: 'HTTP', auth: { type: 'BASIC', username: 'lab', password: 'source-secret' } };
const DATABASE = {
  vendor: 'postgresql', host: 'db.example.org', port: 5432, database: 'lab', username: 'svc', password: 'database-secret', tls: true, query: 'SELECT 1',
};
const HTTP = {
  url: 'https://api.example.org/in', headers: { Accept: 'application/json', Authorization: 'Bearer header-secret' },
  basicAuth: { username: 'svc', password: 'basic-secret' },
};

const UNCHANGED: Stored = { source: SOURCE, destinations: new Map<number, Properties>([[1, DATABASE], [2, HTTP]]) };

describeIntegration('OVERWRITE import and stored credentials (real Postgres)', () => {
  let mods: ServerModules;
  let actor: TestActor;
  let ChannelExportService: typeof import('../../src/services/channel-export.service.js').ChannelExportService;
  let ChannelImportService: typeof import('../../src/services/channel-import.service.js').ChannelImportService;
  let ServerBackupService: typeof import('../../src/services/server-backup.service.js').ServerBackupService;
  const created: string[] = [];
  const users: string[] = [];
  const groups: string[] = [];
  let channelId: string;
  let file: ChannelExportEntry;

  beforeAll(async () => {
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    users.push(actor.userId);
    ({ ChannelExportService } = await import('../../src/services/channel-export.service.js'));
    ({ ChannelImportService } = await import('../../src/services/channel-import.service.js'));
    ({ ServerBackupService } = await import('../../src/services/server-backup.service.js'));
    const channel = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
      name: `itest-credentials-${randomUUID()}`, enabled: false, inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'HTTP', sourceConnectorProperties: SOURCE, responseMode: 'NONE',
    }), actor));
    channelId = channel.id;
    created.push(channelId);
  });

  afterAll(async () => {
    if (created.length > 0) await mods.pool.query('DELETE FROM channels WHERE id = ANY($1::uuid[])', [created]);
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    if (groups.length > 0) await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [groups]);
    await mods?.pool.end();
  });

  // The same stored channel for each test: creating one makes its message partitions, which is slow.
  beforeEach(async () => {
    const { db, eq, schema } = mods;
    await db.update(schema.channels).set({ sourceConnectorType: 'HTTP', sourceConnectorProperties: SOURCE, scriptTimeoutSeconds: 240 })
      .where(eq(schema.channels.id, channelId));
    await db.delete(schema.channelConnectors).where(eq(schema.channelConnectors.channelId, channelId));
    await db.insert(schema.channelConnectors).values([
      { channelId, metaDataId: 1, name: 'Archive', connectorType: 'DATABASE', properties: DATABASE },
      { channelId, metaDataId: 2, name: 'To API', connectorType: 'HTTP', properties: HTTP },
    ]);
    const exported = JSON.stringify(unwrap(await ChannelExportService.exportChannel(channelId)));
    for (const secret of SECRETS) expect(exported).not.toContain(secret);
    file = channelExportSchema.parse(JSON.parse(exported)).channels[0]!;
  });

  async function stored(id = channelId): Promise<Stored> {
    const detail = unwrap(await mods.ChannelService.getById(id));
    return { source: detail.sourceConnectorProperties, destinations: new Map(detail.destinations.map((d) => [d.metaDataId, d.properties])) };
  }

  async function importFile(entry: ChannelExportEntry, mode: CollisionMode = 'OVERWRITE'): Promise<ImportResult> {
    return unwrap(await ChannelImportService.importChannels([entry], mode, actor));
  }

  /** The exported file with properties of one destination changed. */
  function withDestination(metaDataId: number, changes: Properties): ChannelExportEntry {
    return {
      ...file,
      destinations: file.destinations.map((d) => (d.metaDataId === metaDataId ? { ...d, properties: { ...d.properties, ...changes } } : d)),
    };
  }

  const omit = (properties: Properties, key: string): Properties =>
    Object.fromEntries(Object.entries(properties).filter(([name]) => name !== key));

  it('keeps every stored credential and the script timeout when nothing changed', async () => {
    expect(await importFile(file)).toEqual({ created: 0, updated: 1, skipped: 0, errors: [] });
    expect(await stored()).toEqual(UNCHANGED);
    expect(unwrap(await mods.ChannelService.getById(channelId)).scriptTimeoutSeconds).toBe(240);
  });

  it('keeps a credential when only settings that do not decide where it goes changed', async () => {
    const edited = withDestination(1, { query: 'SELECT 2' });
    await importFile({ ...edited, destinations: edited.destinations.map((d) => ({ ...d, name: `${d.name} renamed`, enabled: false, retryCount: 9 })) });
    expect((await stored()).destinations).toEqual(new Map<number, Properties>([[1, { ...DATABASE, query: 'SELECT 2' }], [2, HTTP]]));
  });

  it.each([
    ['host', { host: 'db.attacker.example' }],
    ['TLS flag', { tls: false }],
    ['user name', { username: 'other' }],
  ])('drops a database password when the %s changed, and only that one', async (_what, changes) => {
    await importFile(withDestination(1, changes));
    expect(await stored()).toEqual({
      source: SOURCE,
      destinations: new Map<number, Properties>([[1, { ...omit(DATABASE, 'password'), ...changes }], [2, HTTP]]),
    });
  });

  it.each([
    ['URL', { url: 'https://attacker.example/in' }],
    ['scheme', { scheme: 'HTTP' }],
    ['query parameters', { parameters: { to: 'elsewhere' } }],
    ['Host header', { headers: { Accept: 'application/json', Authorization: '__REDACTED__', Host: 'attacker.example' } }],
    ['Basic user name', { basicAuth: { username: 'other', password: '__REDACTED__' } }],
  ])('drops an HTTP destination\'s credentials when the %s changed', async (_what, changes) => {
    await importFile(withDestination(2, changes));
    const { source, destinations } = await stored();
    expect(JSON.stringify(destinations.get(2))).not.toMatch(/header-secret|basic-secret|__REDACTED__/);
    expect(destinations.get(2)).toMatchObject({ url: ('url' in changes ? changes.url : HTTP.url) });
    expect(destinations.get(1)).toEqual(DATABASE);
    expect(source).toEqual(SOURCE);
  });

  it.each([
    ['port', { port: 18_082 }],
    ['user name', { auth: { type: 'BASIC', username: 'other', password: '__REDACTED__' } }],
    ['auth type', { auth: { type: 'TOKEN', token: '__REDACTED__' } }],
  ])('drops the source\'s credentials when its %s changed', async (_what, changes) => {
    await importFile({ ...file, sourceConnectorProperties: { ...file.sourceConnectorProperties, ...changes } });
    const { source, destinations } = await stored();
    expect(JSON.stringify(source)).not.toMatch(/source-secret|__REDACTED__/);
    expect(destinations).toEqual(UNCHANGED.destinations);
  });

  it('matches a destination by its metaDataId, not by its settings', async () => {
    await importFile({ ...file, destinations: file.destinations.map((d) => ({ ...d, metaDataId: d.metaDataId === 1 ? 3 : d.metaDataId })) });
    expect((await stored()).destinations).toEqual(new Map<number, Properties>([[2, HTTP], [3, omit(DATABASE, 'password')]]));
  });

  it('keeps nothing for a connector whose type changed', async () => {
    await importFile({ ...file, sourceConnectorType: 'AMQP', sourceConnectorProperties: { ...SOURCE, auth: file.sourceConnectorProperties['auth'] } });
    expect(JSON.stringify((await stored()).source)).not.toContain('source-secret');
  });

  it('writes a credential the file holds in clear', async () => {
    await importFile(withDestination(1, { password: 'rotated' }));
    expect((await stored()).destinations.get(1)).toEqual({ ...DATABASE, password: 'rotated' });
  });

  it('copies no stored credential into a new channel', async () => {
    const before = await mods.pool.query<{ id: string }>('SELECT id FROM channels WHERE name = $1', [file.name]);
    expect(await importFile(file, 'CREATE_NEW')).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
    const after = await mods.pool.query<{ id: string }>('SELECT id FROM channels WHERE name = $1', [file.name]);
    const copies = after.rows.map((r) => r.id).filter((id) => !before.rows.some((r) => r.id === id));
    expect(copies).toHaveLength(1);
    created.push(...copies);
    const copy = await stored(copies[0]);
    expect(JSON.stringify([copy.source, ...copy.destinations.values()])).not.toMatch(/secret|__REDACTED__/);
    expect(await stored()).toEqual(UNCHANGED);
  });

  it('keeps every stored credential when a backup is restored onto the server it came from', async () => {
    const { backup } = unwrap(await ServerBackupService.exportBackup('integration test', actor));
    const read = serverBackupSchema.parse(JSON.parse(JSON.stringify(backup)));
    const result = unwrap(await ServerBackupService.restoreBackup({
      ...read,
      channels: read.channels.filter((c) => c.id === channelId),
      codeTemplateLibraries: [], codeTemplates: [], alerts: [], users: [], settings: [], resources: [], channelGroups: [], tags: [],
      channelDependencies: [], configMap: [], globalMap: [], groupMemberships: [], tagAssignments: [],
    }, 'OVERWRITE', actor));
    expect(result.sections.find((s) => s.section === 'channels')).toEqual({ section: 'channels', created: 0, updated: 1, skipped: 0, errors: [] });
    expect(await stored()).toEqual(UNCHANGED);
    expect(unwrap(await mods.ChannelService.getById(channelId)).scriptTimeoutSeconds).toBe(240);
  });

  describe('what a caller learns', () => {
    it('gives nothing to a caller who may not change the channel', async () => {
      const group = await insertTestGroup(mods.pool);
      groups.push(group);
      const outsider = await userWithRole(mods.pool, 'channel-developer', [group]);
      users.push(outsider.id);
      const result = unwrap(await ChannelImportService.importChannels([withDestination(1, { tls: false })], 'OVERWRITE', { userId: outsider.id, ipAddress: null }));
      expect(result).toEqual({ created: 0, updated: 0, skipped: 0, errors: [`Channel "${file.name}": not imported; it would replace a channel you cannot change`] });
      expect(await stored()).toEqual(UNCHANGED);
    });

    it('names no stored credential when the import fails in the database', async () => {
      const tooLong = { ...file, destinations: file.destinations.map((d) => ({ ...d, name: 'x'.repeat(300) })) };
      const result = await importFile(tooLong);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain(`Error importing "${file.name}": value too long for type character varying(255)`);
      for (const secret of SECRETS) expect(JSON.stringify(result)).not.toContain(secret);
    });
  });

  it('reads the stored credentials after it has the channel\'s lock, so a save that was under way is not undone', async () => {
    const writer = await mods.pool.connect();
    let importing: Promise<ImportResult> | undefined;
    try {
      await writer.query('BEGIN');
      await writer.query('UPDATE channels SET revision = revision + 1 WHERE id = $1', [channelId]);
      await writer.query(`UPDATE channel_connectors SET properties = properties || '{"password":"saved-meanwhile"}' WHERE channel_id = $1 AND meta_data_id = 1`, [channelId]);
      importing = importFile(file);
      await waitForBlocked(mods.pool, 'select "id" from "channels"');
      await writer.query('COMMIT');
    } finally {
      await writer.query('ROLLBACK');
      writer.release();
    }
    expect((await importing).errors).toEqual([]);
    expect((await stored()).destinations.get(1)).toEqual({ ...DATABASE, password: 'saved-meanwhile' });
  });
});
