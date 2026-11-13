// ===========================================
// Mirth code template import — real Postgres integration
// ===========================================

import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('Mirth code template import (real Postgres)', () => {
  let mods: ServerModules;
  let templatesMod: typeof import('../../src/services/mirth-code-templates.js');
  let serviceMod: typeof import('../../src/services/code-template.service.js');
  const libraryName = `itest-lib-${randomUUID()}`;

  beforeAll(async () => {
    mods = await loadServerModules();
    templatesMod = await import('../../src/services/mirth-code-templates.js');
    serviceMod = await import('../../src/services/code-template.service.js');
  });

  afterAll(async () => {
    const libs = await serviceMod?.CodeTemplateService.listLibraries();
    const lib = libs?.ok ? libs.value.find((l) => l.name === libraryName) : undefined;
    if (lib) await serviceMod.CodeTemplateService.deleteLibrary(lib.id);
    await mods?.pool.end();
  });

  const library = (code: string): Parameters<typeof templatesMod.importCodeTemplateLibraries>[0] => [{
    name: libraryName,
    description: 'from Mirth',
    templates: [{ name: 'stampSite', description: '', type: 'FUNCTION', code, contexts: ['SOURCE_FILTER_TRANSFORMER'] }],
  }];

  async function stored(): Promise<{ code: string; contexts: readonly string[] } | undefined> {
    const libs = unwrap(await serviceMod.CodeTemplateService.listLibraries());
    const lib = libs.find((l) => l.name === libraryName);
    if (!lib) return undefined;
    const templates = unwrap(await serviceMod.CodeTemplateService.listTemplates(lib.id));
    return templates.find((t) => t.name === 'stampSite');
  }

  it('creates the library and template, skips them on a second import, and replaces them on OVERWRITE', async () => {
    expect(unwrap(await templatesMod.importCodeTemplateLibraries(library('function stampSite() { return 1; }'), false)))
      .toEqual({ created: 1, updated: 0, skipped: 0 });
    expect(await stored()).toMatchObject({ code: 'function stampSite() { return 1; }', contexts: ['SOURCE_FILTER_TRANSFORMER'] });

    expect(unwrap(await templatesMod.importCodeTemplateLibraries(library('function stampSite() { return 2; }'), false)))
      .toEqual({ created: 0, updated: 0, skipped: 1 });
    expect((await stored())?.code).toBe('function stampSite() { return 1; }');

    expect(unwrap(await templatesMod.importCodeTemplateLibraries(library('function stampSite() { return 3; }'), true)))
      .toEqual({ created: 0, updated: 1, skipped: 0 });
    expect((await stored())?.code).toBe('function stampSite() { return 3; }');
  });
});
