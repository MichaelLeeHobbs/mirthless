// A destination keeps its number across saves, and no other destination of the channel gets it (#395, D-348).

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { channelExportSchema, createChannelSchema, updateChannelSchema, type ChannelExportEntry } from '@galvanigraph/core-models';
import type { ChannelDetail } from '../../src/services/channel.service.js';
import { adminActor, deleteTestChannel, describeIntegration, insertTestChannel, loadServerModules, unwrap, type ServerModules, type TestActor } from './_setup.js';
import { migratedFrom, type MigrationDb } from './_migration-db.js';

describeIntegration('Destination numbers across saves (real Postgres)', () => {
  let mods: ServerModules;
  let actor: TestActor;
  const created: string[] = [];

  beforeAll(async () => {
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
  });

  afterEach(async () => {
    for (const id of created.splice(0)) await deleteTestChannel(mods, id);
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  const writer = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
    ({ name, enabled: true, connectorType: 'JAVASCRIPT', properties: { script: `return '${name}';` }, ...extra });
  const rejecting = (script: string): Record<string, unknown> => ({ rules: [{ type: 'JAVASCRIPT', script, language: 'JAVASCRIPT' }] });

  function base(): Record<string, unknown> {
    return {
      name: `itest-395-${randomUUID()}`, inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];', pollingIntervalMs: 600_000 },
    };
  }

  async function createChannel(body: Record<string, unknown>): Promise<ChannelDetail> {
    const channel = unwrap(await mods.ChannelService.create(createChannelSchema.parse({ ...base(), ...body }), actor));
    created.push(channel.id);
    return channel;
  }

  async function update(channel: ChannelDetail, body: Record<string, unknown>): Promise<ChannelDetail> {
    return unwrap(await mods.ChannelService.update(channel.id, updateChannelSchema.parse({ revision: channel.revision, ...body }), actor));
  }

  const numbered = (channel: ChannelDetail): unknown[] => channel.destinations.map((d) => [d.metaDataId, d.name]);
  const sent = (channel: ChannelDetail, name: string): Record<string, unknown> => ({ ...channel.destinations.find((d) => d.name === name)! });

  it('keeps each number when destinations are removed, moved and added, and gives none out twice', async () => {
    const first = await createChannel({ destinations: [writer('Lab'), writer('Clinic'), writer('Ward')] });
    expect(numbered(first)).toEqual([[1, 'Lab'], [2, 'Clinic'], [3, 'Ward']]);

    const second = await update(first, { destinations: [sent(first, 'Ward'), writer('Archive', { id: 'new-1' }), sent(first, 'Clinic')] });
    expect(numbered(second)).toEqual([[3, 'Ward'], [4, 'Archive'], [2, 'Clinic']]);

    const third = await update(second, { destinations: [sent(second, 'Clinic')] });
    const fourth = await update(third, { destinations: [sent(third, 'Clinic'), writer('Ward', { id: 'new-1' }), writer('Lab', { id: 'new-2' })] });
    expect(numbered(fourth)).toEqual([[2, 'Clinic'], [5, 'Ward'], [6, 'Lab']]);
    expect(unwrap(await mods.ChannelService.getById(first.id)).destinations).toEqual(fourth.destinations);
  });

  it('keeps the number of a destination that is renamed and pointed somewhere else', async () => {
    const first = await createChannel({ destinations: [writer('Lab'), writer('Clinic')] });
    const second = await update(first, { destinations: [{ ...sent(first, 'Lab'), name: 'Other', properties: { script: "return 'other';" } }, sent(first, 'Clinic')] });
    expect(numbered(second)).toEqual([[1, 'Other'], [2, 'Clinic']]);
  });

  it('updates a destination in place: its row and its scripts stay, and what the save leaves out is reset', async () => {
    const first = await createChannel({
      destinations: [writer('Lab', { queueMode: 'ALWAYS', retryCount: 7, responseTransformer: 'return 1;', responseTransformerLanguage: 'TYPESCRIPT' }), writer('Clinic')],
      filters: [{ metaDataId: 2, ...rejecting('return true;') }],
    });
    const clinic = first.destinations[1]!;
    expect(first.filters.map((f) => f.connectorId)).toEqual([clinic.id]);

    const second = await update(first, { destinations: [sent(first, 'Clinic'), { ...writer('Lab'), id: first.destinations[0]!.id }] });

    expect(second.destinations.map((d) => d.id)).toEqual([clinic.id, first.destinations[0]!.id]);
    expect(second.filters).toEqual(first.filters);
    expect(second.destinations[1]).toMatchObject({ queueMode: 'NEVER', retryCount: 0, responseTransformer: null, responseTransformerLanguage: 'JAVASCRIPT' });
  });

  it('a removed destination takes its filter with it', async () => {
    const first = await createChannel({ destinations: [writer('Lab'), writer('Clinic')], filters: [{ metaDataId: 1, ...rejecting('return true;') }] });
    expect((await update(first, { destinations: [sent(first, 'Clinic')] })).filters).toEqual([]);
  });

  it('puts a filter and a transformer on the destination the request names by its id, a new one included', async () => {
    const first = await createChannel({ destinations: [writer('Lab')] });
    const second = await update(first, {
      destinations: [writer('Clinic', { id: 'new-1' }), sent(first, 'Lab')],
      filters: [{ connectorId: 'new-1', ...rejecting('return true;') }, { connectorId: null, ...rejecting('return false;') }],
      transformers: [{ connectorId: first.destinations[0]!.id, steps: [{ type: 'JAVASCRIPT', script: 'msg = msg;', language: 'JAVASCRIPT' }] }],
    });
    const [clinic, lab] = second.destinations;
    expect(second.filters.map((f) => f.connectorId).sort()).toEqual([clinic!.id, null].sort());
    expect(second.transformers.map((t) => t.connectorId)).toEqual([lab!.id]);

    const third = await update(second, { filters: [{ connectorId: lab!.id, ...rejecting('return true;') }] });
    expect(third.filters.map((f) => f.connectorId)).toEqual([lab!.id]);
  });

  it('refuses a filter for a destination the request removes, and changes nothing', async () => {
    const first = await createChannel({ destinations: [writer('Lab'), writer('Clinic')] });
    const refused = await mods.ChannelService.update(first.id, updateChannelSchema.parse({
      revision: first.revision, destinations: [sent(first, 'Clinic')], filters: [{ connectorId: first.destinations[0]!.id, ...rejecting('return true;') }],
    }), actor);

    expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(unwrap(await mods.ChannelService.getById(first.id))).toMatchObject({ revision: first.revision, destinations: [{ name: 'Lab' }, { name: 'Clinic' }] });
  });

  it('tells an editor that is behind that it is, not that its destination is unknown', async () => {
    const first = await createChannel({ destinations: [writer('Lab'), writer('Clinic')] });
    await update(first, { destinations: [sent(first, 'Clinic')] });

    const stale = await mods.ChannelService.update(first.id, updateChannelSchema.parse({
      revision: first.revision, destinations: [sent(first, 'Lab')], filters: [{ connectorId: 'nobody', ...rejecting('return true;') }],
    }), actor);

    expect(stale).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('refuses two destinations with one id in a new channel, and makes none', async () => {
    const body: Record<string, unknown> = { ...base(), destinations: [writer('Lab', { id: 'x' }), writer('Clinic', { id: 'x' })], filters: [{ connectorId: 'x', ...rejecting('return true;') }] };
    const refused = await mods.ChannelService.create(createChannelSchema.parse(body), actor);
    expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Two destinations have the id "x"' } });
    const { rows } = await mods.pool.query('SELECT id FROM channels WHERE name = $1', [body['name']]);
    expect(rows).toEqual([]);
  });

  it('refuses a list that was read before an import or an older server gave the destinations other ids, and renumbers nothing', async () => {
    const first = await createChannel({ destinations: [writer('Lab'), writer('Clinic')] });
    const before = unwrap(await mods.ChannelService.getById(first.id));
    await mods.pool.query('UPDATE channel_connectors SET id = gen_random_uuid() WHERE channel_id = $1', [first.id]);

    const refused = await mods.ChannelService.update(first.id, updateChannelSchema.parse({ revision: first.revision, destinations: [sent(before, 'Lab'), sent(before, 'Clinic')] }), actor);

    expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: expect.stringContaining('Read the channel again') } });
    expect(numbered(unwrap(await mods.ChannelService.getById(first.id)))).toEqual([[1, 'Lab'], [2, 'Clinic']]);
  });

  it('refuses to put a filter on a destination of another channel', async () => {
    const other = await createChannel({ destinations: [writer('Lab')] });
    const refused = await mods.ChannelService.create(createChannelSchema.parse({
      ...base(), destinations: [writer('Mine')], filters: [{ connectorId: other.destinations[0]!.id, ...rejecting('return true;') }],
    }), actor);
    expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('a clone has the numbers and the order of the channel it copies, and goes on from there', async () => {
    const first = await createChannel({ destinations: [writer('Lab'), writer('Clinic'), writer('Ward')], filters: [{ metaDataId: 3, ...rejecting('return true;') }] });
    const source = await update(first, { destinations: [sent(first, 'Ward'), sent(first, 'Clinic')] });

    const clone = unwrap(await mods.ChannelService.clone(source.id, `itest-395-${randomUUID()}`, actor));
    created.push(clone.id);

    expect(numbered(clone)).toEqual([[3, 'Ward'], [2, 'Clinic']]);
    expect(clone.filters.map((f) => f.connectorId)).toEqual([clone.destinations[0]!.id]);
    expect(numbered(await update(clone, { destinations: [writer('New', { id: 'new' })] }))).toEqual([[4, 'New']]);
  });

  describe('an import', () => {
    let exportMod: typeof import('../../src/services/channel-export.service.js');
    let importMod: typeof import('../../src/services/channel-import.service.js');

    beforeAll(async () => {
      exportMod = await import('../../src/services/channel-export.service.js');
      importMod = await import('../../src/services/channel-import.service.js');
    });

    async function fileOf(channel: ChannelDetail): Promise<ChannelExportEntry> {
      const exported = unwrap(await exportMod.ChannelExportService.exportChannel(channel.id));
      return channelExportSchema.parse(JSON.parse(JSON.stringify(exported))).channels[0]!;
    }

    async function imported(file: ChannelExportEntry, mode: 'SKIP' | 'OVERWRITE' | 'CREATE_NEW' = 'OVERWRITE'): Promise<readonly string[]> {
      return unwrap(await importMod.ChannelImportService.importChannels([file], mode, actor)).errors;
    }

    const read = async (channel: ChannelDetail): Promise<ChannelDetail> => unwrap(await mods.ChannelService.getById(channel.id));
    const identified = (channel: ChannelDetail): unknown[] => channel.destinations.map((d) => [d.id, d.metaDataId, d.name]);

    async function queue(channel: ChannelDetail, metaDataId: number): Promise<void> {
      const { messageId } = unwrap(await mods.MessageService.createMessage(channel.id, 'itest'));
      unwrap(await mods.MessageService.createConnectorMessage(channel.id, messageId, metaDataId, 'D', 'QUEUED'));
    }

    it('into a server that does not have the channel brings the ids, the numbers and the order', async () => {
      const first = await createChannel({ destinations: [writer('Lab'), writer('Clinic'), writer('Ward')], filters: [{ metaDataId: 3, ...rejecting('return true;') }] });
      const source = await update(first, { destinations: [sent(first, 'Ward'), sent(first, 'Clinic')] });
      const file = await fileOf(source);
      await deleteTestChannel(mods, source.id);

      expect(await imported(file)).toEqual([]);

      const copy = await read(source);
      expect(identified(copy)).toEqual(identified(source));
      expect(copy.filters.map((f) => f.connectorId)).toEqual([copy.destinations[0]!.id]);
      expect(numbered(await update(copy, { destinations: [writer('New', { id: 'new' })] }))).toEqual([[4, 'New']]);
    });

    it('as a new channel beside the one exported gets ids of its own', async () => {
      const first = await createChannel({ destinations: [writer('Lab')] });
      expect(await imported(await fileOf(first), 'CREATE_NEW')).toEqual([]);
      const { rows } = await mods.pool.query<{ id: string; meta_data_id: number; channel_id: string }>(
        'SELECT cc.id, cc.meta_data_id, cc.channel_id FROM channel_connectors cc JOIN channels c ON c.id = cc.channel_id WHERE c.name = $1 AND c.id <> $2', [first.name, first.id]);
      expect(rows).toHaveLength(1);
      created.push(rows[0]!.channel_id);
      expect(rows[0]).toMatchObject({ meta_data_id: 1 });
      expect(rows[0]!.id).not.toBe(first.destinations[0]!.id);
    });

    it('over the channel keeps each destination as the file has it, renamed and repointed ones too, while messages wait', async () => {
      const first = await createChannel({ destinations: [writer('Lab'), writer('Clinic')] });
      await queue(first, 1);
      const file = await fileOf(first);
      const [lab, clinic] = file.destinations;

      expect(await imported({ ...file, destinations: [clinic!, { ...lab!, name: 'Laboratory', properties: { script: 'return 2;' } }] })).toEqual([]);

      expect(identified(await read(first))).toEqual([[clinic!.id, 2, 'Clinic'], [lab!.id, 1, 'Laboratory']]);
    });

    it('never gives a new destination a number the channel has used', async () => {
      const first = await createChannel({ destinations: [writer('Lab'), writer('Clinic')] });
      const file = await fileOf(first);
      const second = await update(first, { destinations: [sent(first, 'Lab')] });
      const ward = { ...file.destinations[1]!, id: randomUUID(), name: 'Ward' };

      expect(await imported({ ...file, destinations: [file.destinations[0]!, ward] })).toEqual([]);
      expect(numbered(await read(second))).toEqual([[1, 'Lab'], [3, 'Ward']]);
    });

    it('counts the numbers it brought, so one it takes away again is not given out', async () => {
      const first = await createChannel({ destinations: [writer('Lab')] });
      const file = await fileOf(first);
      const ward = { ...file.destinations[0]!, id: randomUUID(), metaDataId: 2, name: 'Ward' };
      expect(await imported({ ...file, destinations: [...file.destinations, ward] })).toEqual([]);
      expect(await imported(file)).toEqual([]);

      const now = await read(first);
      expect(numbered(await update(now, { destinations: [sent(now, 'Lab'), writer('New', { id: 'new' })] }))).toEqual([[1, 'Lab'], [3, 'New']]);
    });

    it('knows its destinations by ids in capitals', async () => {
      const first = await createChannel({ destinations: [writer('Lab')] });
      const file = await fileOf(first);
      const shouted = channelExportSchema.shape.channels.parse([{ ...file, destinations: [{ ...file.destinations[0]!, id: file.destinations[0]!.id!.toUpperCase(), name: 'Laboratory' }] }]);
      expect(await imported(shouted[0]!)).toEqual([]);
      expect(identified(await read(first))).toEqual([[file.destinations[0]!.id, 1, 'Laboratory']]);
    });

    it('is refused, and changes nothing, when that would change a number its scripts go by', async () => {
      const first = await createChannel({ destinations: [writer('Lab'), writer('Clinic')], transformers: [{ steps: [{ type: 'JAVASCRIPT', script: 'destinationSet.remove(2);' }] }] });
      const file = await fileOf(first);
      const second = await update(first, { destinations: [sent(first, 'Lab')] });

      expect(await imported(file)).toEqual([expect.stringContaining('"Clinic" (2) cannot have the metaDataId')]);
      expect(await read(second)).toEqual(second);
    });

    it('of a file without ids is refused when it would send what waits for a destination somewhere else', async () => {
      const first = await createChannel({ destinations: [writer('Lab')] });
      const { destinations: [lab], ...rest } = await fileOf(first);
      const { id: _id, ...older } = lab!;
      const moved = { ...rest, destinations: [{ ...older, properties: { script: 'return 2;' } }] };
      await queue(first, 1);

      expect(await imported(moved)).toEqual([expect.stringContaining('messages wait on the queue of "Lab"')]);
      expect(identified(await read(first))).toEqual(identified(first));

      // One that is not known to be for it never leaves its queue, so it does not stand in the way.
      await mods.pool.query('UPDATE connector_messages SET number_kept = false WHERE channel_id = $1', [first.id]);
      expect(await imported(moved)).toEqual([]);
      expect(identified(await read(first))).toEqual(identified(first));
    });

    it.each([0, 2_147_483_647])('of the number %i is refused', async (metaDataId) => {
      const first = await createChannel({ destinations: [writer('Lab')] });
      const file = await fileOf(first);
      expect(await imported({ ...file, destinations: [{ ...file.destinations[0]!, metaDataId }] })).toEqual([expect.stringContaining(`has the metaDataId ${String(metaDataId)}`)]);
    });
  });

  it('goes past the numbers of destinations that were written without counting them', async () => {
    const id = randomUUID();
    await insertTestChannel(mods, id);
    created.push(id);
    await mods.db.insert(mods.schema.channelConnectors).values([1, 2].map((n) => ({ channelId: id, metaDataId: n, position: n, name: `D${String(n)}`, connectorType: 'JAVASCRIPT', properties: { script: '' } })));
    const seeded = unwrap(await mods.ChannelService.getById(id));

    expect(numbered(await update(seeded, { destinations: [...seeded.destinations, writer('New', { id: 'new' })] }))).toEqual([[1, 'D1'], [2, 'D2'], [3, 'New']]);
  });
});

describeIntegration('Migration 0028 (real Postgres)', () => {
  const LAST_BEFORE = 27;

  interface Dest { readonly n: number; readonly name: string; readonly url?: string; readonly type?: string }
  const lab: Dest = { n: 1, name: 'Lab' };
  const clinic: Dest = { n: 2, name: 'Clinic' };

  interface Case {
    readonly saved: readonly Dest[];
    /** The recorded deployment's destinations, or anything else its JSON may hold. */
    readonly deployed?: readonly Dest[] | { readonly raw: unknown };
    /** The numbers that messages are stored under. */
    readonly messages?: readonly number[];
    readonly counted?: number;
    readonly deleted?: boolean;
    readonly next: number;
    /** Null: the channel has no such messages. */
    readonly old: { readonly names: Record<string, string>; readonly namesOnceDeployed?: Record<string, string> } | null;
  }
  const CASES: Readonly<Record<string, Case>> = {
    plain: { saved: [lab, clinic], next: 3, old: null },
    'with messages, never deployed': { saved: [lab, clinic], messages: [1], next: 3, old: { names: { 1: 'Lab', 2: 'Clinic' } } },
    'with two of one name': { saved: [lab, clinic, { n: 3, name: 'Lab' }], messages: [1], next: 4, old: { names: { 2: 'Clinic' } } },
    'with messages for a removed destination': { saved: [lab], messages: [4], next: 5, old: { names: { 1: 'Lab' } } },
    'with statistics of a removed destination': { saved: [lab], counted: 5, next: 6, old: null },
    'deployed as saved': { saved: [lab, clinic], deployed: [lab, clinic], messages: [1], next: 3, old: { names: { 1: 'Lab', 2: 'Clinic' } } },
    'renumbered by a save': { saved: [{ n: 1, name: 'Clinic' }], deployed: [lab, clinic], messages: [1], next: 3, old: { names: { 1: 'Lab', 2: 'Clinic' }, namesOnceDeployed: {} } },
    'renumbered by a save, without messages': { saved: [{ n: 1, name: 'Clinic' }], deployed: [lab, clinic], next: 3, old: { names: { 1: 'Lab', 2: 'Clinic' }, namesOnceDeployed: {} } },
    'with one replaced by another of its name': { saved: [{ ...lab, url: 'elsewhere' }, clinic], deployed: [lab, clinic], messages: [1], next: 3, old: { names: { 1: 'Lab', 2: 'Clinic' }, namesOnceDeployed: { 2: 'Clinic' } } },
    'with one of another type': { saved: [{ ...lab, type: 'FHIR' }, clinic], deployed: [lab, clinic], messages: [1], next: 3, old: { names: { 1: 'Lab', 2: 'Clinic' }, namesOnceDeployed: { 2: 'Clinic' } } },
    'whose record has a number twice': { saved: [], deployed: [lab, { ...clinic, n: 1 }], messages: [1], next: 2, old: { names: {} } },
    'with one that now has the name of another': { saved: [lab, { n: 2, name: 'Lab' }], deployed: [lab, clinic], messages: [1], next: 3, old: { names: { 1: 'Lab', 2: 'Clinic' }, namesOnceDeployed: {} } },
    'with one added and one removed by a save': { saved: [lab, { n: 3, name: 'New' }], deployed: [lab, clinic], messages: [1], next: 4, old: { names: { 1: 'Lab', 2: 'Clinic' } } },
    'with two of one name deployed': { saved: [lab, clinic], deployed: [lab, { n: 2, name: 'Lab' }], messages: [1], next: 3, old: { names: {}, namesOnceDeployed: {} } },
    'deployed with a higher number': { saved: [lab], deployed: [{ n: 6, name: 'Old' }, clinic], next: 7, old: null },
    'whose record is no list': { saved: [lab], deployed: { raw: { destinations: 'none' } }, messages: [1], next: 2, old: { names: {} } },
    'whose record has odd destinations': { saved: [lab], deployed: { raw: { destinations: [null, 'x', { metaDataId: '1', name: 'Lab' }, { metaDataId: 1, name: 7 }, { metaDataId: 1.5, name: 'Half' }] } }, messages: [1], next: 3, old: { names: { 1.5: 'Half' } } },
    'whose record is empty': { saved: [], deployed: { raw: {} }, next: 1, old: null },
    'that was deleted': { saved: [lab], messages: [1], deleted: true, next: 2, old: { names: { 1: 'Lab' } } },
    'with the highest number there is': { saved: [{ n: 2_147_483_647, name: 'Huge' }], next: 2_147_483_647, old: null },
  };
  const ids = new Map(Object.keys(CASES).map((name) => [name, randomUUID()]));
  let migrated: MigrationDb;

  const stored = ({ n, name, url = 'here', type = 'HTTP' }: Dest): Record<string, unknown> => ({ metaDataId: n, name, connectorType: type, properties: { url, method: 'POST' } });

  beforeAll(async () => {
    migrated = await migratedFrom(LAST_BEFORE, async (client) => {
      for (const [name, { saved, deployed, messages = [], counted, deleted }] of Object.entries(CASES)) {
        const id = ids.get(name)!;
        await client.query(
          `INSERT INTO channels (id, name, inbound_data_type, outbound_data_type, source_connector_type, source_connector_properties, deleted_at)
           VALUES ($1, $2, 'RAW', 'RAW', 'CHANNEL', '{}', $3)`, [id, name, deleted ? new Date() : null]);
        await client.query('SELECT public.create_channel_partitions($1::uuid)', [id]);
        for (const dest of saved) {
          const { properties, connectorType } = stored(dest);
          await client.query('INSERT INTO channel_connectors (channel_id, meta_data_id, name, connector_type, properties) VALUES ($1, $2, $3, $4, $5)', [id, dest.n, dest.name, connectorType, JSON.stringify(properties)]);
        }
        if (deployed !== undefined) {
          const record = 'raw' in deployed ? deployed.raw : { destinations: (deployed as readonly Dest[]).map(stored) };
          await client.query(`INSERT INTO channel_deployments (channel_id, channel_revision, format, channel, code_templates, global_scripts) VALUES ($1, 1, 1, $2, '[]', '{}')`, [id, JSON.stringify(record)]);
        }
        for (const n of messages) {
          const { rows } = await client.query<{ id: string }>('INSERT INTO messages (channel_id) VALUES ($1) RETURNING id', [id]);
          await client.query(`INSERT INTO connector_messages (channel_id, message_id, meta_data_id, status) VALUES ($1, $2, $3, 'QUEUED')`, [id, rows[0]!.id, n]);
        }
        if (counted !== undefined) await client.query(`INSERT INTO message_statistics (channel_id, meta_data_id, server_id) VALUES ($1, $2, 's')`, [id, counted]);
      }
    });
  });

  afterAll(async () => {
    await migrated?.drop();
  });

  it.each(Object.entries(CASES))('a channel %s: its next number, and which messages are whose', async (name, { next, old }) => {
    const { rows } = await migrated.client.query('SELECT next_meta_data_id AS next, old_numbers AS old FROM channels WHERE id = $1', [ids.get(name)]);
    expect(rows).toEqual([{ next, old }]);
  });

  it('marks what is stored, and not what is stored from now on', async () => {
    const id = ids.get('deployed as saved');
    await migrated.client.query(`INSERT INTO connector_messages (channel_id, message_id, meta_data_id, status) SELECT channel_id, message_id, 2, 'QUEUED' FROM connector_messages WHERE channel_id = $1`, [id]);
    const { rows } = await migrated.client.query('SELECT meta_data_id AS n, number_kept AS kept FROM connector_messages WHERE channel_id = $1 ORDER BY n', [id]);
    expect(rows).toEqual([{ n: 1, kept: false }, { n: 2, kept: true }]);
  });

  it('lets no server of the version before save a destination, which would renumber the channel', async () => {
    const older = migrated.client.query('INSERT INTO channel_connectors (channel_id, meta_data_id, name, connector_type, properties) VALUES ($1, 9, $2, $3, $4)', [ids.get('plain'), 'X', 'HTTP', '{}']);
    await expect(older).rejects.toThrow('null value in column "position"');
  });

  it('lists the destinations in the order of their numbers', async () => {
    const { rows } = await migrated.client.query('SELECT meta_data_id, position FROM channel_connectors WHERE channel_id = $1 ORDER BY position', [ids.get('plain')]);
    expect(rows).toEqual([{ meta_data_id: 1, position: 1 }, { meta_data_id: 2, position: 2 }]);
  });
});
