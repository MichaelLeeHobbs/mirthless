import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createChannelSchema, updateChannelSchema } from '@galvanigraph/core-models';
import { adminActor, describeIntegration, loadServerModules, unwrap, type ServerModules, type TestActor } from './_setup.js';

describeIntegration('Channel export and import (real Postgres)', () => {
  let mods: ServerModules;
  let actor: TestActor;
  let exportMod: typeof import('../../src/services/channel-export.service.js');
  let importMod: typeof import('../../src/services/channel-import.service.js');
  const created: string[] = [];

  beforeAll(async () => {
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    exportMod = await import('../../src/services/channel-export.service.js');
    importMod = await import('../../src/services/channel-import.service.js');
  });

  afterAll(async () => {
    for (const id of created) await mods.ChannelService.delete(id);
    await mods?.pool.end();
  });

  it('attaches destination filters and transformers to the imported destination', async () => {
    const { ChannelService } = mods;
    const name = `itest-export-${randomUUID()}`;
    const source = unwrap(await ChannelService.create(createChannelSchema.parse({
      name,
      enabled: false,
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'JAVASCRIPT',
      sourceConnectorProperties: {},
      responseMode: 'AUTO_AFTER_DESTINATIONS',
      destinations: [
        { name: 'First', connectorType: 'JAVASCRIPT', properties: { script: 'return;' } },
        { name: 'Second', connectorType: 'JAVASCRIPT', properties: { script: 'return;' } },
      ],
      filters: [{ metaDataId: 2, rules: [{ name: 'Second only', type: 'JAVASCRIPT', operator: 'AND', script: 'return true;' }] }],
      transformers: [{ metaDataId: 2, inboundDataType: 'RAW', outboundDataType: 'RAW', steps: [{ name: 'Stamp', type: 'JAVASCRIPT', script: 'msg = msg;' }] }],
    }), actor));
    created.push(source.id);

    const exported = unwrap(await exportMod.ChannelExportService.exportChannel(source.id));
    const entry = exported.channels[0]!;
    const copyId = randomUUID();
    created.push(copyId);
    const result = unwrap(await importMod.ChannelImportService.importChannels(
      [{ ...entry, id: copyId, name: `${name}-copy` }], 'CREATE_NEW', actor,
    ));
    expect(result.errors).toEqual([]);

    await expectAttachedToSecond(copyId);

    const again = unwrap(await importMod.ChannelImportService.importChannels(
      [{ ...entry, id: copyId, name: `${name}-copy` }], 'OVERWRITE', actor,
    ));
    expect(again.errors).toEqual([]);
    await expectAttachedToSecond(copyId);
  });

  const rawChannel = (name: string): ReturnType<typeof createChannelSchema.parse> => createChannelSchema.parse({
    name, enabled: false, inboundDataType: 'RAW', outboundDataType: 'RAW',
    sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: {}, responseMode: 'NONE',
  });

  async function channelRows(column: 'id' | 'name', value: string): Promise<number> {
    const { db, sql } = mods;
    const result = await db.execute(sql`SELECT count(*)::int AS n FROM channels WHERE ${sql.identifier(column)} = ${value}`);
    return (result.rows[0] as { n: number }).n;
  }

  const REFUSED_MARKER = 'itest: partitions refused';

  async function withPartitionsRefused(body: () => Promise<void>): Promise<void> {
    const { db, sql } = mods;
    const def = await db.execute(sql`SELECT pg_get_functiondef('public.create_channel_partitions(uuid)'::regprocedure) AS def`);
    const original = (def.rows[0] as { def: string }).def;
    // A run that crashed before its `finally` would leave the stub in place;
    // never "restore" that as if it were the real function.
    expect(original).toContain('SECURITY DEFINER');
    expect(original).not.toContain(REFUSED_MARKER);
    await db.execute(sql.raw(
      `CREATE OR REPLACE FUNCTION public.create_channel_partitions(p_channel_id uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${REFUSED_MARKER}'; END; $$`,
    ));
    try {
      await body();
    } finally {
      await db.execute(sql.raw(original));
    }
  }

  it('creates, clones and imports channels with their own partitions (#260)', async () => {
    const { ChannelService, PartitionManagerService } = mods;
    const name = `itest-partitions-${randomUUID()}`;
    const source = unwrap(await ChannelService.create(rawChannel(name), actor));
    created.push(source.id);
    expect(unwrap(await PartitionManagerService.partitionExists(source.id))).toBe(true);

    const clone = unwrap(await ChannelService.clone(source.id, `${name}-clone`, actor));
    created.push(clone.id);
    expect(unwrap(await PartitionManagerService.partitionExists(clone.id))).toBe(true);

    const entry = unwrap(await exportMod.ChannelExportService.exportChannel(source.id)).channels[0]!;
    const copyId = randomUUID();
    created.push(copyId);
    const result = unwrap(await importMod.ChannelImportService.importChannels([{ ...entry, id: copyId, name: `${name}-copy` }], 'CREATE_NEW', actor));
    expect(result.errors).toEqual([]);
    expect(unwrap(await PartitionManagerService.partitionExists(copyId))).toBe(true);
  });

  it('leaves no channel row when the partitions cannot be created (#260)', async () => {
    const { ChannelService } = mods;
    const name = `itest-refused-${randomUUID()}`;
    const source = unwrap(await ChannelService.create(rawChannel(name), actor));
    created.push(source.id);
    const entry = unwrap(await exportMod.ChannelExportService.exportChannel(source.id)).channels[0]!;
    const copyId = randomUUID();

    await withPartitionsRefused(async () => {
      const refused = await ChannelService.create(rawChannel(`${name}-new`), actor);
      expect(refused.ok).toBe(false);
      expect(refused.error?.message).toContain(`Channel "${name}-new" was not created: its message partitions could not be created`);
      expect(await channelRows('name', `${name}-new`)).toBe(0);

      const cloned = await ChannelService.clone(source.id, `${name}-clone`, actor);
      expect(cloned.ok).toBe(false);
      expect(await channelRows('name', `${name}-clone`)).toBe(0);

      const imported = unwrap(await importMod.ChannelImportService.importChannels([{ ...entry, id: copyId, name: `${name}-copy` }], 'CREATE_NEW', actor));
      expect(imported.created).toBe(0);
      expect(imported.errors).toEqual([expect.stringContaining(`Error importing "${name}-copy": its message partitions could not be created, so it was not imported`)]);
      expect(await channelRows('id', copyId)).toBe(0);
    });

    const after = unwrap(await ChannelService.create(rawChannel(`${name}-after`), actor));
    created.push(after.id);
    expect(unwrap(await mods.PartitionManagerService.partitionExists(after.id))).toBe(true);
  });

  it('keeps every script language and the response transformer through save, export and import', async () => {
    const { ChannelService } = mods;
    const name = `itest-languages-${randomUUID()}`;
    const source = unwrap(await ChannelService.create(createChannelSchema.parse({
      name,
      enabled: false,
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'JAVASCRIPT',
      sourceConnectorProperties: {},
      responseMode: 'AUTO_AFTER_DESTINATIONS',
      scripts: { preprocessor: 'return rawData;', languages: { preprocessor: 'TYPESCRIPT' } },
      destinations: [{
        name: 'To EHR', connectorType: 'JAVASCRIPT', properties: { script: 'return;' },
        responseTransformer: 'return msg;', responseTransformerLanguage: 'TYPESCRIPT',
      }],
      filters: [{ rules: [{ name: 'TS rule', type: 'JAVASCRIPT', operator: 'AND', script: 'return true;', language: 'TYPESCRIPT' }] }],
      transformers: [{ inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', steps: [{ name: 'JS step', type: 'JAVASCRIPT', script: 'msg = msg;' }] }],
    }), actor));
    created.push(source.id);

    const expectLanguages = async (id: string): Promise<void> => {
      const detail = unwrap(await ChannelService.getById(id));
      expect(detail.scripts.find((s) => s.scriptType === 'PREPROCESSOR')?.language).toBe('TYPESCRIPT');
      expect(detail.scripts.find((s) => s.scriptType === 'DEPLOY')?.language).toBe('JAVASCRIPT');
      expect(detail.filters[0]?.rules[0]?.language).toBe('TYPESCRIPT');
      // A step sent without a language is stored as JavaScript, how it was written.
      expect(detail.transformers[0]?.steps[0]?.language).toBe('JAVASCRIPT');
      expect(detail.destinations[0]?.responseTransformer).toBe('return msg;');
      expect(detail.destinations[0]?.responseTransformerLanguage).toBe('TYPESCRIPT');
    };
    await expectLanguages(source.id);

    const exported = unwrap(await exportMod.ChannelExportService.exportChannel(source.id));
    const copyId = randomUUID();
    created.push(copyId);
    const result = unwrap(await importMod.ChannelImportService.importChannels(
      [{ ...exported.channels[0]!, id: copyId, name: `${name}-copy` }], 'CREATE_NEW', actor,
    ));
    expect(result.errors).toEqual([]);
    await expectLanguages(copyId);
  });

  it('updates a channel script language, and an update without languages keeps the stored ones', async () => {
    const { ChannelService } = mods;
    const created1 = unwrap(await ChannelService.create(createChannelSchema.parse({
      name: `itest-lang-update-${randomUUID()}`, enabled: false, inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: {}, responseMode: 'NONE',
    }), actor));
    created.push(created1.id);
    const before = unwrap(await ChannelService.getById(created1.id));

    const updated = unwrap(await ChannelService.update(created1.id, updateChannelSchema.parse({
      revision: before.revision,
      scripts: { deploy: 'logger.info("up");', languages: { deploy: 'TYPESCRIPT' } },
    })));
    const afterTs = unwrap(await ChannelService.getById(created1.id));
    expect(afterTs.scripts.find((s) => s.scriptType === 'DEPLOY')).toMatchObject({ script: 'logger.info("up");', language: 'TYPESCRIPT' });

    // A language the request leaves out keeps the stored one, so the script stays type-checked (D-294).
    const kept = unwrap(await ChannelService.update(created1.id, updateChannelSchema.parse({
      revision: updated.revision, scripts: { deploy: 'logger.info("still ts");' },
    })));
    const afterKept = unwrap(await ChannelService.getById(created1.id));
    expect(afterKept.scripts.find((s) => s.scriptType === 'DEPLOY')).toMatchObject({ script: 'logger.info("still ts");', language: 'TYPESCRIPT' });

    unwrap(await ChannelService.update(created1.id, updateChannelSchema.parse({
      revision: kept.revision, scripts: { deploy: 'logger.info("js");', languages: { deploy: 'JAVASCRIPT' } },
    })));
    const afterJs = unwrap(await ChannelService.getById(created1.id));
    expect(afterJs.scripts.find((s) => s.scriptType === 'DEPLOY')?.language).toBe('JAVASCRIPT');
  });

  it('refuses a destination filter named only by another server\'s connector id', async () => {
    const id = randomUUID();
    created.push(id);
    const result = unwrap(await importMod.ChannelImportService.importChannels([{
      id, name: `itest-orphan-${id}`, description: null, enabled: false, revision: 1,
      inboundDataType: 'RAW', outboundDataType: 'RAW', sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: {},
      responseMode: 'NONE', responseConnectorName: null, initialState: 'STOPPED', messageStorageMode: 'DEVELOPMENT',
      encryptData: false, removeContentOnCompletion: false, removeAttachmentsOnCompletion: false,
      pruningEnabled: false, pruningMaxAgeDays: null, pruningArchiveEnabled: false, scripts: [],
      destinations: [{ metaDataId: 1, name: 'Only', enabled: true, connectorType: 'JAVASCRIPT', properties: {}, queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 10000, rotateQueue: false, queueThreadCount: 1, waitForPrevious: false }],
      metadataColumns: [],
      filters: [{ connectorId: randomUUID(), rules: [] }],
      transformers: [],
    }], 'CREATE_NEW', actor));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('export the channel again');
    expect((await mods.ChannelService.getById(id)).ok).toBe(false);
  });

  async function expectAttachedToSecond(channelId: string): Promise<void> {
    const copy = unwrap(await mods.ChannelService.getById(channelId));
    const second = copy.destinations.find((d) => d.name === 'Second');
    expect(second).toBeDefined();
    expect(copy.transformers.find((t) => t.connectorId === second!.id)?.steps[0]?.name).toBe('Stamp');
    expect(copy.filters.find((f) => f.connectorId === second!.id)?.rules[0]?.name).toBe('Second only');
  }
});
