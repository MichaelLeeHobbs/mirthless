// ===========================================
// Mirth code template library conversion tests
// ===========================================

import { describe, it, expect, vi } from 'vitest';
import type { MirthConvertResult } from '../mirth-import.service.js';

vi.mock('../../lib/db.js', () => ({ db: {} }));
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn() }));

import { MirthImportService } from '../mirth-import.service.js';

function template(name: string, type: string, code: string, contexts: readonly string[]): string {
  return `<codeTemplate version="4.5.0"><id>${name}-id</id><name>${name}</name><revision>1</revision>
<contextSet><delegate>${contexts.map((c) => `<contextType>${c}</contextType>`).join('')}</delegate></contextSet>
<properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties"><type>${type}</type><code>${code}</code></properties></codeTemplate>`;
}

function library(name: string, templates: string, enabledFor: readonly string[] = [], includeNew = false): string {
  return `<codeTemplateLibrary version="4.5.0"><id>${name}-lib</id><name>${name}</name><description>About ${name}</description>
<includeNewChannels>${String(includeNew)}</includeNewChannels>
<enabledChannelIds>${enabledFor.map((c) => `<string>${c}</string>`).join('')}</enabledChannelIds><disabledChannelIds/>
<codeTemplates>${templates}</codeTemplates></codeTemplateLibrary>`;
}

const CHANNEL_ID = '5c000400-0000-4000-8000-000000000001';

/** Convert a server backup holding one channel and the given libraries. */
function convertBackup(libraries: string): MirthConvertResult {
  const xml = `<serverConfiguration version="4.5.0"><channels><channel version="4.5.0"><id>${CHANNEL_ID}</id><name>C</name>
<sourceConnector><properties class="com.mirth.connect.connectors.vm.VmReceiverProperties"/></sourceConnector><destinationConnectors/></channel></channels>
<codeTemplateLibraries>${libraries}</codeTemplateLibraries></serverConfiguration>`;
  const result = MirthImportService.convertXml(xml);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('code template libraries in a Mirth server backup', () => {
  it('converts each library and template with decoded code and its contexts', () => {
    const result = convertBackup(library('Globals', template('stampSite', 'FUNCTION', 'function stampSite(m) { return m &amp;&amp; m; }', ['SOURCE_FILTER_TRANSFORMER', 'CHANNEL_POSTPROCESSOR'])));
    expect(result.codeTemplateLibraries).toEqual([{
      name: 'Globals',
      description: 'About Globals',
      channelIds: [],
      templates: [{
        name: 'stampSite', description: '', type: 'FUNCTION',
        code: 'function stampSite(m) { return m && m; }',
        contexts: ['SOURCE_FILTER_TRANSFORMER', 'CHANNEL_POSTPROCESSOR'],
      }],
    }]);
  });

  it('adds compiled code to scripts like a function, and keeps drag-and-drop code as an editor snippet', () => {
    const result = convertBackup(library('L', template('a', 'COMPILED_CODE', 'var a = 1;', ['CHANNEL_DEPLOY']) + template('b', 'DRAG_AND_DROP_CODE', 'b();', ['CHANNEL_DEPLOY'])));
    expect(result.codeTemplateLibraries[0]?.templates.map((t) => t.type)).toEqual(['FUNCTION', 'CODE_BLOCK']);
  });

  it('drops contexts it does not know', () => {
    const result = convertBackup(library('L', template('a', 'FUNCTION', 'x', ['CHANNEL_DEPLOY', 'SOMETHING_NEW'])));
    expect(result.codeTemplateLibraries[0]?.templates[0]?.contexts).toEqual(['CHANNEL_DEPLOY']);
  });

  it('scopes a library to the channels Mirth enabled it for, or to every channel with "include new channels"', () => {
    const result = convertBackup(library('Some', template('a', 'FUNCTION', 'x', []), [CHANNEL_ID]) + library('All', template('b', 'FUNCTION', 'y', []), [CHANNEL_ID], true));
    expect(result.codeTemplateLibraries.map((l) => [l.name, l.channelIds])).toEqual([['Some', [CHANNEL_ID]], ['All', null]]);
    expect(result.warnings.filter((w) => w.startsWith('Code template library'))).toEqual([]);
  });

  it('warns that a channel Mirth excluded from an "include new channels" library gets it here', () => {
    const xml = library('All', template('b', 'FUNCTION', 'y', []), [], true).replace('<disabledChannelIds/>', `<disabledChannelIds><string>${CHANNEL_ID}</string></disabledChannelIds>`);
    expect(convertBackup(xml).warnings).toContain('Code template library "All": Mirth disabled it for some channels; here it applies to every channel');
  });

  it('has no libraries for a single channel export', () => {
    const result = MirthImportService.convertXml('<channel version="4.5.0"><name>C</name><destinationConnectors/></channel>');
    if (!result.ok) throw result.error;
    expect(result.value.codeTemplateLibraries).toEqual([]);
  });
});
