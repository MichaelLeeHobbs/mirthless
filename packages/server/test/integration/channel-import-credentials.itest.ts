// An export masks credentials. Importing it with OVERWRITE keeps the stored
// ones only for a connector that still goes to the same place as the same user
// (#334, D-335).

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { channelExportSchema, createChannelSchema, serverBackupSchema, updateChannelSchema, type ChannelExportEntry, type CollisionMode, type ImportResult } from '@galvanigraph/core-models';
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
    await db.update(schema.channels).set({ sourceConnectorType: 'HTTP', sourceConnectorProperties: SOURCE, scriptTimeoutSeconds: 240, nextMetaDataId: 3, deletedAt: null })
      .where(eq(schema.channels.id, channelId));
    await db.delete(schema.channelConnectors).where(eq(schema.channelConnectors.channelId, channelId));
    await db.insert(schema.channelConnectors).values([
      { channelId, metaDataId: 1, position: 1, name: 'Archive', connectorType: 'DATABASE', properties: DATABASE },
      { channelId, metaDataId: 2, position: 2, name: 'To API', connectorType: 'HTTP', properties: HTTP },
    ]);
    file = await exportedFile();
    for (const secret of SECRETS) expect(JSON.stringify(file)).not.toContain(secret);
  });

  async function exportedFile(): Promise<ChannelExportEntry> {
    const exported = unwrap(await ChannelExportService.exportChannel(channelId));
    return channelExportSchema.parse(JSON.parse(JSON.stringify(exported))).channels[0]!;
  }

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
    await importFile({ ...edited, destinations: edited.destinations.map((d) => ({ ...d, enabled: false, retryCount: 9 })) });
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

  it('drops an AMQP destination\'s credentials when a header a headers exchange routes by changed', async () => {
    const { db, eq, schema } = mods;
    const amqp = { host: 'mq.example.org', exchange: 'lab', username: 'svc', password: 'queue-secret', headers: { dest: 'ehr', apiToken: 'header-secret' } };
    await db.update(schema.channelConnectors).set({ connectorType: 'AMQP', properties: amqp }).where(eq(schema.channelConnectors.channelId, channelId));
    file = await exportedFile();
    await importFile(file);
    expect((await stored()).destinations).toEqual(new Map<number, Properties>([[1, amqp], [2, amqp]]));
    await importFile(withDestination(1, { headers: { dest: 'elsewhere', apiToken: '__REDACTED__' } }));
    const { destinations } = await stored();
    expect(destinations.get(1)).toEqual({ ...omit(amqp, 'password'), headers: { dest: 'elsewhere' } });
    expect(destinations.get(2)).toEqual(amqp);
  });

  it('keeps the credentials in a URL and in headers saved as text, until the file changes the rest of them', async () => {
    const { db, eq, schema } = mods;
    const http = { url: 'https://svc:url-secret@api.example.org/in?token=query-secret', headers: 'Accept: text/plain\nAuthorization: Bearer text-secret' };
    await db.update(schema.channelConnectors).set({ connectorType: 'HTTP', properties: http }).where(eq(schema.channelConnectors.channelId, channelId));
    file = await exportedFile();
    expect(JSON.stringify(file.destinations)).not.toMatch(/url-secret|query-secret|text-secret/);
    await importFile(file);
    expect((await stored()).destinations).toEqual(new Map<number, Properties>([[1, http], [2, http]]));

    const url = String(file.destinations[0]!.properties['url']).replace('api.example.org', 'attacker.example');
    await importFile(withDestination(1, { url }));
    const { destinations } = await stored();
    // Without a URL the deploy is refused, so the mask is never sent and no credential is left out unnoticed.
    expect(destinations.get(1)).toEqual({ headers: 'Accept: text/plain' });
    expect(destinations.get(2)).toEqual(http);
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

  const withoutIds = (entry: ChannelExportEntry): ChannelExportEntry => ({ ...entry, destinations: entry.destinations.map(({ id: _id, ...d }) => d) });

  it.each([
    ['metaDataId', { metaDataId: 3 }],
    ['name', { name: 'Archive 2' }],
  ])('keeps a destination\'s credential when its %s changed in a file that has its id, and drops it when the file has none', async (_what, changes) => {
    const changed = { ...file, destinations: file.destinations.map((d) => (d.metaDataId === 1 ? { ...d, ...changes } : d)) };
    expect(await importFile(changed)).toMatchObject({ updated: 1, errors: [] });
    expect((await stored()).destinations).toEqual(UNCHANGED.destinations);

    await importFile(file);
    expect(await importFile(withoutIds(changed))).toMatchObject({ updated: 1, errors: [] });
    const { destinations } = await stored();
    expect([...destinations.keys()].sort()).toEqual([2, 3]);
    expect(destinations.get(3)).toEqual(omit(DATABASE, 'password'));
    expect(destinations.get(2)).toEqual(HTTP);
  });

  describe.each([
    ['an HTTP header key', 'HTTP', { url: HTTP.url }, (secret: string): Properties => ({ headers: { 'X-API-Key': secret } })],
    ['an HTTP query key', 'HTTP', { url: HTTP.url }, (secret: string): Properties => ({ parameters: { apiKey: secret } })],
    ['a FHIR bearer token', 'FHIR', { baseUrl: HTTP.url, authType: 'BEARER' }, (secret: string): Properties => ({ authToken: secret })],
    ['a FHIR API key', 'FHIR', { baseUrl: HTTP.url, authType: 'API_KEY', authHeaderName: 'X-Key' }, (secret: string): Properties => ({ authApiKey: secret })],
  ])('with two destinations that differ only in %s', (_what, connectorType, shared, withSecret) => {
    interface Named {
      readonly name: string;
      readonly connectorType: string;
      readonly properties: Properties;
    }
    const a: Named = { name: 'A', connectorType, properties: { ...shared, ...withSecret('key-of-a') } };
    const b: Named = { name: 'B', connectorType, properties: { ...shared, ...withSecret('key-of-b') } };

    const keyOf = (d: Named): string => JSON.stringify(d.properties).match(/key-of-\w/)![0];

    /** Each is the stored one with its key, or new. */
    async function save(...destinations: readonly Named[]): Promise<void> {
      const { revision, destinations: now } = unwrap(await mods.ChannelService.getById(channelId));
      const idOf = (d: Named): string => now.find((s) => JSON.stringify(s.properties).includes(keyOf(d)))?.id ?? `new-${keyOf(d)}`;
      unwrap(await mods.ChannelService.update(channelId, updateChannelSchema.parse({
        revision, destinations: destinations.map((d) => ({ ...d, enabled: true, id: idOf(d) })),
      }), actor));
    }

    async function expectOwnKeys(...destinations: readonly Named[]): Promise<void> {
      expect(await storedByName()).toEqual(destinations.map((d) => [d.name, expect.stringContaining(keyOf(d))]));
    }

    async function storedByName(): Promise<ReadonlyArray<readonly [string, string]>> {
      const { destinations } = unwrap(await mods.ChannelService.getById(channelId));
      return destinations.map((d) => [d.name, JSON.stringify(d.properties)] as const);
    }

    async function expectNoKeys(): Promise<void> {
      for (const [name, properties] of await storedByName()) expect(properties, name).not.toMatch(/key-of-|__REDACTED__/);
    }

    it('keeps each one its own key, also when they were reordered since the export', async () => {
      await save(a, b);
      const older = await exportedFile();
      for (const file of [older, withoutIds(older)]) {
        await save(b, a);
        expect(await importFile(file)).toMatchObject({ updated: 1, errors: [] });
        await expectOwnKeys(a, b);
      }
    });

    it('gives a deleted one no key when an older file brings it back, and the other one keeps its own', async () => {
      await save(a, b);
      const older = await exportedFile();
      await save(b);
      expect(await importFile(older)).toMatchObject({ updated: 1, errors: [] });
      expect(await storedByName()).toEqual([['A', expect.not.stringMatching(/key-of-|__REDACTED__/)], ['B', expect.stringContaining('key-of-b')]]);
    });

    it('keeps each one its own key when their numbers have gaps', async () => {
      const { db, eq, schema } = mods;
      await db.delete(schema.channelConnectors).where(eq(schema.channelConnectors.channelId, channelId));
      await db.insert(schema.channelConnectors).values([{ channelId, metaDataId: 2, position: 1, ...a }, { channelId, metaDataId: 5, position: 2, ...b }]);
      const older = await exportedFile();
      await save(b, a);
      expect(await importFile(older)).toMatchObject({ updated: 1, errors: [] });
      await expectOwnKeys(a, b);
    });

    it('tells two with one name apart by their ids, and gives neither a key when the file has none', async () => {
      const twin = { ...b, name: a.name };
      await save(a, twin);
      const both = await exportedFile();
      await save(twin, a);
      expect(await importFile(both)).toMatchObject({ updated: 1, errors: [] });
      await expectOwnKeys(a, twin);

      expect(await importFile(withoutIds(both))).toMatchObject({ updated: 1, errors: [] });
      await expectNoKeys();

      await save(a, twin);
      await save(twin);
      expect(await importFile(withoutIds(both))).toMatchObject({ updated: 1, errors: [] });
      await expectNoKeys();

      await save(a, twin);
      await importFile(withoutIds({ ...both, destinations: both.destinations.slice(0, 1) }));
      await expectNoKeys();
    });
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

  describe('when another change to the channel is under way', () => {
    /** Imports the file while `statements` hold the channel's row, and lets them commit once the import waits for it. */
    async function importDuring(entry: ChannelExportEntry, ...statements: readonly string[]): Promise<ImportResult> {
      const writer = await mods.pool.connect();
      try {
        await writer.query('BEGIN');
        for (const statement of statements) await writer.query(statement, [channelId]);
        const importing = importFile(entry);
        await waitForBlocked(mods.pool, 'select "id", "enabled" from "channels"');
        await writer.query('COMMIT');
        return await importing;
      } finally {
        await writer.query('ROLLBACK');
        writer.release();
      }
    }

    it('keeps the credential a save just stored, not the one it replaced', async () => {
      const result = await importDuring(
        file,
        'UPDATE channels SET revision = revision + 1 WHERE id = $1',
        `UPDATE channel_connectors SET properties = properties || '{"password":"saved-meanwhile"}' WHERE channel_id = $1 AND meta_data_id = 1`,
      );
      expect(result.errors).toEqual([]);
      expect((await stored()).destinations.get(1)).toEqual({ ...DATABASE, password: 'saved-meanwhile' });
    });

    it('does not overwrite a channel that was just deleted', async () => {
      const result = await importDuring({ ...file, description: 'written over a deleted channel' }, 'UPDATE channels SET deleted_at = now() WHERE id = $1');
      expect(result).toEqual({
        created: 0, updated: 0, skipped: 0, errors: [`Channel "${file.name}": not imported; it was deleted while the import waited for it`],
      });
      const { rows } = await mods.pool.query<{ description: string }>('SELECT description FROM channels WHERE id = $1', [channelId]);
      expect(rows.map((r) => r.description)).toEqual([file.description]);
    });
  });
});
