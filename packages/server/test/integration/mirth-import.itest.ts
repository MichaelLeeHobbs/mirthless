// What an import of a Mirth file does to channels that are here already (#418).

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { adminActor, describeIntegration, loadServerModules, unwrap, type ServerModules, type TestActor } from './_setup.js';

interface Stored {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly revision: number;
  readonly targets: readonly (string | null)[];
}

describeIntegration('Mirth import over channels that are here (real Postgres)', () => {
  let mods: ServerModules;
  let actor: TestActor;
  let MirthImportService: typeof import('../../src/services/mirth-import.service.js').MirthImportService;
  let ChannelExportService: typeof import('../../src/services/channel-export.service.js').ChannelExportService;
  let ChannelImportService: typeof import('../../src/services/channel-import.service.js').ChannelImportService;
  const run = randomUUID();

  beforeAll(async () => {
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    ({ MirthImportService } = await import('../../src/services/mirth-import.service.js'));
    ({ ChannelExportService } = await import('../../src/services/channel-export.service.js'));
    ({ ChannelImportService } = await import('../../src/services/channel-import.service.js'));
  });

  afterAll(async () => {
    await mods?.pool.query('DELETE FROM channels WHERE name LIKE $1', [`${run}%`]);
    await mods?.pool.query('DELETE FROM users WHERE id = $1::uuid', [actor?.userId]);
    await mods?.pool.end();
  });

  const channelXml = (id: string, name: string, source: string, destinations = ''): string => `<channel version="4.5.0"><id>${id}</id><name>${run} ${name}</name><sourceConnector version="4.5.0">${source}</sourceConnector><destinationConnectors>${destinations}</destinationConnectors><properties version="4.5.0"/></channel>`;
  const CHANNEL_READER = '<properties class="com.mirth.connect.connectors.vm.VmReceiverProperties" version="4.5.0"/><transportName>Channel Reader</transportName>';
  const fileReader = (extra = ''): string => `<properties class="com.mirth.connect.connectors.file.FileReceiverProperties" version="4.5.0"><scheme>FILE</scheme><host>/data/in</host><fileFilter>*</fileFilter><afterProcessingAction>DELETE</afterProcessingAction>${extra}</properties><transportName>File Reader</transportName>`;
  const channelWriter = (n: number, target: string): string => `<connector version="4.5.0"><metaDataId>${String(n)}</metaDataId><name>W${String(n)}</name><enabled>true</enabled><transportName>Channel Writer</transportName><properties class="com.mirth.connect.connectors.vm.VmDispatcherProperties" version="4.5.0"><channelId>${target}</channelId></properties></connector>`;

  async function stored(name: string): Promise<readonly Stored[]> {
    const { rows } = await mods.pool.query<Stored>(
      `SELECT c.id, c.name, c.enabled, c.revision,
              COALESCE((SELECT json_agg(k.properties->>'targetChannelId' ORDER BY k.meta_data_id) FROM channel_connectors k WHERE k.channel_id = c.id), '[]') AS targets
       FROM channels c WHERE c.name = $1 AND c.deleted_at IS NULL ORDER BY c.created_at`, [`${run} ${name}`]);
    return rows;
  }

  async function importXml(xml: string, collisionMode: 'SKIP' | 'OVERWRITE' | 'RENAME'): Promise<{ readonly created: number; readonly updated: number; readonly errors: readonly string[] }> {
    return unwrap(await MirthImportService.importFromXml(xml, { collisionMode, dryRun: false }, actor)).importResult;
  }

  async function copyOf(name: string, originalId: string): Promise<Stored> {
    const copy = (await stored(name)).find((c) => c.id !== originalId);
    if (!copy) throw new Error(`${name} has no copy`);
    return copy;
  }

  it('points the copies\' Channel Writers at each other, and leaves the originals and other targets alone', async () => {
    const [a, b, elsewhere] = [randomUUID(), randomUUID(), randomUUID()];
    const file = `<list>${channelXml(a, 'A', CHANNEL_READER, channelWriter(1, b.toUpperCase()) + channelWriter(2, elsewhere) + channelWriter(3, a))}${channelXml(b, 'B', CHANNEL_READER)}</list>`;
    expect(await importXml(file, 'SKIP')).toMatchObject({ created: 2, errors: [] });
    expect(await importXml(file, 'RENAME')).toMatchObject({ created: 2, errors: [] });

    const copyA = await copyOf('A', a);
    const copyB = await copyOf('B', b);
    expect(copyA.targets).toEqual([copyB.id, elsewhere, copyA.id]);
    expect((await stored('A')).find((c) => c.id === a)?.targets).toEqual([b, elsewhere, a]);
  });

  it('points a new channel\'s writer at the copy of a channel that was here', async () => {
    const [d, e] = [randomUUID(), randomUUID()];
    await importXml(channelXml(e, 'E', CHANNEL_READER), 'SKIP');
    const file = `<list>${channelXml(d, 'D', CHANNEL_READER, channelWriter(1, e))}${channelXml(e, 'E', CHANNEL_READER)}</list>`;
    expect(await importXml(file, 'RENAME')).toMatchObject({ created: 2, errors: [] });
    const copyE = await copyOf('E', e);
    expect(await stored('D')).toMatchObject([{ id: d, targets: [copyE.id] }]);
  });

  it('does the same for a GalvaniGraph export imported as new channels', async () => {
    const [x, y] = [randomUUID(), randomUUID()];
    expect(await importXml(`<list>${channelXml(x, 'X', CHANNEL_READER, channelWriter(1, y))}${channelXml(y, 'Y', CHANNEL_READER)}</list>`, 'SKIP')).toMatchObject({ created: 2 });
    const entries = [x, y].map(async (id) => unwrap(await ChannelExportService.exportChannel(id)).channels[0]!);
    const result = unwrap(await ChannelImportService.importChannels(await Promise.all(entries), 'CREATE_NEW', actor));
    expect(result).toMatchObject({ created: 2, errors: [] });
    expect((await copyOf('X', x)).targets).toEqual([(await copyOf('Y', y)).id]);
  });

  it('refuses to overwrite an enabled channel with one that must not run yet, and leaves it as it was', async () => {
    const id = randomUUID();
    await importXml(channelXml(id, 'Reader', fileReader()), 'SKIP');
    const before = await stored('Reader');
    expect(before).toMatchObject([{ id, enabled: true }]);

    const held = channelXml(id, 'Reader', fileReader('<fileSizeMinimum>1000</fileSizeMinimum>'));
    const refused = await importXml(held, 'OVERWRITE');
    expect(refused).toMatchObject({ created: 0, updated: 0 });
    expect(refused.errors).toHaveLength(1);
    expect(refused.errors[0]).toContain('file size range');
    expect(refused.errors[0]).toContain('Disable the channel');
    expect(await stored('Reader')).toEqual(before);

    await mods.pool.query('UPDATE channels SET enabled = false WHERE id = $1::uuid', [id]);
    expect(await importXml(held, 'OVERWRITE')).toMatchObject({ updated: 1, errors: [] });
    expect(await stored('Reader')).toMatchObject([{ id, enabled: false }]);
  });

  it('refuses it for a channel disabled in Mirth too, since the overwrite would leave it enabled here', async () => {
    const id = randomUUID();
    await importXml(channelXml(id, 'Off', fileReader()), 'SKIP');
    const held = channelXml(id, 'Off', fileReader('<fileSizeMinimum>1000</fileSizeMinimum>')).replace('</channel>', '<exportData><metadata><enabled>false</enabled></metadata></exportData></channel>');
    expect((await importXml(held, 'OVERWRITE')).errors).toHaveLength(1);
  });

  it('overwrites an enabled channel that nothing holds, and leaves it enabled (D-328)', async () => {
    const id = randomUUID();
    await importXml(channelXml(id, 'Plain', fileReader()), 'SKIP');
    expect(await importXml(channelXml(id, 'Plain', fileReader()), 'OVERWRITE')).toMatchObject({ updated: 1, errors: [] });
    expect(await stored('Plain')).toMatchObject([{ id, enabled: true }]);
  });
});
