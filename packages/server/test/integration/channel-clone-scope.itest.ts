// ===========================================
// Channel clone and code template library scope — real Postgres integration
// ===========================================
// A clone joins every library whose channel list names the original (D-249),
// so its scripts get the same template functions. A library for every channel
// (null list) and a library for other channels are left as they were.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createChannelSchema } from '@galvanigraph/core-models';
import { adminActor, describeIntegration, loadServerModules, unwrap, type ServerModules, type TestActor } from './_setup.js';

describeIntegration('Channel clone keeps code template library scope (real Postgres)', () => {
  let mods: ServerModules;
  let actor: TestActor;
  let templates: typeof import('../../src/services/code-template.service.js').CodeTemplateService;
  const channelIds: string[] = [];
  const libraryIds: string[] = [];
  const tag = randomUUID().slice(0, 8);

  beforeAll(async () => {
    mods = await loadServerModules();
    actor = await adminActor(mods.pool);
    ({ CodeTemplateService: templates } = await import('../../src/services/code-template.service.js'));
  });

  afterAll(async () => {
    for (const id of libraryIds) await templates.deleteLibrary(id);
    for (const id of channelIds) await mods.ChannelService.delete(id);
    await mods?.pool.end();
  });

  const library = async (name: string, ids: string[] | null): Promise<string> => {
    const lib = unwrap(await templates.createLibrary({ name: `${name}-${tag}`, description: '', channelIds: ids }));
    libraryIds.push(lib.id);
    return lib.id;
  };

  it('adds the clone to libraries listing the original and leaves the others alone', async () => {
    const original = unwrap(await mods.ChannelService.create(createChannelSchema.parse({
      name: `itest-clone-src-${tag}`, enabled: false, inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: {}, responseMode: 'AUTO_AFTER_DESTINATIONS',
    }), actor));
    channelIds.push(original.id);
    const other = randomUUID();
    const listing = await library('listing', [other, original.id]);
    const everyone = await library('everyone', null);
    const elsewhere = await library('elsewhere', [other]);

    const clone = unwrap(await mods.ChannelService.clone(original.id, `itest-clone-copy-${tag}`, actor));
    channelIds.push(clone.id);

    const byId = new Map(unwrap(await templates.listLibraries()).map((l) => [l.id, l]));
    expect(byId.get(listing)?.channelIds).toEqual([other, original.id, clone.id]);
    expect(byId.get(listing)?.revision).toBe(2);
    expect(byId.get(everyone)?.channelIds).toBeNull();
    expect(byId.get(everyone)?.revision).toBe(1);
    expect(byId.get(elsewhere)?.channelIds).toEqual([other]);
    expect(byId.get(elsewhere)?.revision).toBe(1);
  });
});
