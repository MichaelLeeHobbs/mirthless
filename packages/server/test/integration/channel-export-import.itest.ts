// ===========================================
// Channel export -> import round trip — real Postgres integration
// ===========================================
// A destination's filter and transformer must come back attached to the
// imported channel's own destination row. The export used to carry only the
// exporting server's connector row id, which the import wrote into a foreign
// key that no longer (or never) existed, and the import failed.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createChannelSchema, updateChannelSchema } from '@galvaniflow/core-models';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('Channel export and import (real Postgres)', () => {
  let mods: ServerModules;
  let exportMod: typeof import('../../src/services/channel-export.service.js');
  let importMod: typeof import('../../src/services/channel-import.service.js');
  const created: string[] = [];

  beforeAll(async () => {
    mods = await loadServerModules();
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
    })));
    created.push(source.id);

    const exported = unwrap(await exportMod.ChannelExportService.exportChannel(source.id));
    const entry = exported.channels[0]!;
    const copyId = randomUUID();
    created.push(copyId);
    const result = unwrap(await importMod.ChannelImportService.importChannels(
      [{ ...entry, id: copyId, name: `${name}-copy` }], 'CREATE_NEW',
    ));
    expect(result.errors).toEqual([]);

    await expectAttachedToSecond(copyId);

    // Importing over the existing channel replaces its destination rows too.
    const again = unwrap(await importMod.ChannelImportService.importChannels(
      [{ ...entry, id: copyId, name: `${name}-copy` }], 'OVERWRITE',
    ));
    expect(again.errors).toEqual([]);
    await expectAttachedToSecond(copyId);
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
    })));
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
      [{ ...exported.channels[0]!, id: copyId, name: `${name}-copy` }], 'CREATE_NEW',
    ));
    expect(result.errors).toEqual([]);
    await expectLanguages(copyId);
  });

  it('updates a channel script language, and an update without languages keeps the stored ones', async () => {
    const { ChannelService } = mods;
    const created1 = unwrap(await ChannelService.create(createChannelSchema.parse({
      name: `itest-lang-update-${randomUUID()}`, enabled: false, inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: {}, responseMode: 'NONE',
    })));
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

    // A language the request gives replaces it.
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
    }], 'CREATE_NEW'));
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
