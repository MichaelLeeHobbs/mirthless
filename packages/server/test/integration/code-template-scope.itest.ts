// ===========================================
// Code template library scope — real Postgres integration
// ===========================================
// A library for some channels only reaches only those channels' scripts; a
// library with no scope reaches every channel.

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('Code template library scope (real Postgres)', () => {
  let mods: ServerModules;
  let service: typeof import('../../src/services/code-template.service.js').CodeTemplateService;
  const north = randomUUID();
  const south = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const libraryIds: string[] = [];

  beforeAll(async () => {
    mods = await loadServerModules();
    ({ CodeTemplateService: service } = await import('../../src/services/code-template.service.js'));
    const add = async (name: string, channelIds: string[] | null): Promise<void> => {
      const lib = unwrap(await service.createLibrary({ name: `${name}-${tag}`, description: '', channelIds }));
      libraryIds.push(lib.id);
      unwrap(await service.createTemplate({
        libraryId: lib.id, name: `${name}-${tag}`, description: '', type: 'FUNCTION', language: 'JAVASCRIPT',
        code: `function f_${name}_${tag.replace(/-/g, '')}() { return 1; }`, contexts: ['SOURCE_FILTER_TRANSFORMER'],
      }));
    };
    await add('everyone', null);
    await add('north', [north]);
    await add('both', [north, south]);
  });

  afterAll(async () => {
    for (const id of libraryIds) await service.deleteLibrary(id);
    await mods?.pool.end();
  });

  const names = async (channelId: string): Promise<string[]> =>
    unwrap(await service.listTemplatesForChannel(channelId)).map((t) => t.name).filter((n) => n.endsWith(tag)).sort();

  it('gives a channel the unscoped libraries and the ones that name it', async () => {
    expect(await names(north)).toEqual([`both-${tag}`, `everyone-${tag}`, `north-${tag}`]);
    expect(await names(south)).toEqual([`both-${tag}`, `everyone-${tag}`]);
    expect(await names(randomUUID())).toEqual([`everyone-${tag}`]);
  });

  it('returns the scope with the library and lets an update change it', async () => {
    const lib = unwrap(await service.listLibraries()).find((l) => l.name === `north-${tag}`)!;
    expect(lib.channelIds).toEqual([north]);
    unwrap(await service.updateLibrary(lib.id, { channelIds: null, revision: lib.revision }));
    expect(await names(south)).toContain(`north-${tag}`);
  });
});
