// ===========================================
// Mirth Connect code template libraries
// ===========================================
// A Mirth server backup carries its code template libraries next to the
// channels. Channel scripts call those templates (`msg = stampSite(msg)`), so a
// channel imported without them fails on its first message.

import { tryCatch, type Result } from 'stderr-lib';
import { CODE_TEMPLATE_CONTEXTS } from '@galvaniflow/core-models';
import { CodeTemplateService, type TemplateDetail } from './code-template.service.js';
import type { AuditContext } from '../lib/event-emitter.js';

// ----- Types -----

type CodeTemplateContext = (typeof CODE_TEMPLATE_CONTEXTS)[number];

/** One template as converted from the export. */
export interface MirthCodeTemplate {
  readonly name: string;
  readonly description: string;
  readonly type: 'FUNCTION' | 'CODE_BLOCK';
  readonly code: string;
  readonly contexts: readonly CodeTemplateContext[];
}

/** One library as converted from the export. */
export interface MirthCodeTemplateLibrary {
  readonly name: string;
  readonly description: string;
  readonly templates: readonly MirthCodeTemplate[];
}

/** What importing the libraries did. */
export interface CodeTemplateImportCounts {
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
}

/** Readers for the parsed XML, shared with the channel importer. */
export interface XmlReaders {
  readonly isRecord: (v: unknown) => v is Record<string, unknown>;
  readonly getString: (obj: unknown, key: string) => string | null;
  readonly toRecordList: (node: unknown) => readonly Record<string, unknown>[];
}

// ----- Conversion -----

const KNOWN_CONTEXTS: ReadonlySet<string> = new Set(CODE_TEMPLATE_CONTEXTS);

/**
 * Mirth template types: FUNCTION and COMPILED_CODE are added to every script
 * in their contexts; DRAG_AND_DROP_CODE is a snippet for the editor only.
 */
function mapTemplateType(type: string | null): 'FUNCTION' | 'CODE_BLOCK' {
  return type === 'DRAG_AND_DROP_CODE' ? 'CODE_BLOCK' : 'FUNCTION';
}

function convertTemplate(node: Record<string, unknown>, xml: XmlReaders): MirthCodeTemplate | null {
  const name = xml.getString(node, 'name');
  const props = node['properties'];
  if (!name || !xml.isRecord(props)) return null;
  const contextSet = node['contextSet'];
  const delegate = xml.isRecord(contextSet) ? contextSet['delegate'] : null;
  const rawContexts = xml.isRecord(delegate) ? delegate['contextType'] : null;
  const contextList = Array.isArray(rawContexts) ? rawContexts : rawContexts == null ? [] : [rawContexts];
  const contexts = contextList.map(String).filter((c): c is CodeTemplateContext => KNOWN_CONTEXTS.has(c));
  return {
    name,
    description: xml.getString(props, 'description') ?? xml.getString(node, 'description') ?? '',
    type: mapTemplateType(xml.getString(props, 'type')),
    code: xml.getString(props, 'code') ?? '',
    contexts,
  };
}

/**
 * Libraries in a server backup (`serverConfiguration/codeTemplateLibraries`).
 * Mirth can enable a library for some channels only; here every template is
 * available to every channel, so the caller warns when a library names channels.
 */
export function extractCodeTemplateLibraries(
  parsed: Record<string, unknown>,
  xml: XmlReaders,
  warnings: string[],
): readonly MirthCodeTemplateLibrary[] {
  const server = parsed['serverConfiguration'];
  if (!xml.isRecord(server)) return [];
  const librariesNode = server['codeTemplateLibraries'];
  const libraryNodes = xml.isRecord(librariesNode) ? xml.toRecordList(librariesNode['codeTemplateLibrary']) : [];
  return libraryNodes.flatMap((lib) => {
    const name = xml.getString(lib, 'name');
    if (!name) return [];
    const templatesNode = lib['codeTemplates'];
    const templates = (xml.isRecord(templatesNode) ? xml.toRecordList(templatesNode['codeTemplate']) : [])
      .map((t) => convertTemplate(t, xml))
      .filter((t): t is MirthCodeTemplate => t !== null);
    const enabled = lib['enabledChannelIds'];
    if (xml.getString(lib, 'includeNewChannels') !== 'true' && xml.isRecord(enabled) && enabled['string'] !== undefined) {
      warnings.push(`Code template library "${name}": Mirth enabled it for some channels only; here its templates are available to every channel`);
    }
    return [{ name, description: xml.getString(lib, 'description') ?? '', templates }];
  });
}

// ----- Persistence -----

/**
 * Create each library and template that does not exist, matched by name.
 * OVERWRITE replaces an existing template's code, type and contexts; any other
 * mode leaves it as it is.
 */
export async function importCodeTemplateLibraries(
  libraries: readonly MirthCodeTemplateLibrary[],
  overwrite: boolean,
  context?: AuditContext,
): Promise<Result<CodeTemplateImportCounts>> {
  return tryCatch(async () => {
    const counts = { created: 0, updated: 0, skipped: 0 };
    if (libraries.length === 0) return counts;
    const existingLibraries = await CodeTemplateService.listLibraries();
    if (!existingLibraries.ok) throw existingLibraries.error;
    for (const lib of libraries) {
      const libraryId = existingLibraries.value.find((l) => l.name === lib.name)?.id
        ?? await createLibrary(lib, context);
      const existing = await CodeTemplateService.listTemplates(libraryId);
      if (!existing.ok) throw existing.error;
      for (const template of lib.templates) {
        const outcome = await importTemplate(libraryId, template, existing.value, overwrite, context);
        counts[outcome]++;
      }
    }
    return counts;
  });
}

async function createLibrary(lib: MirthCodeTemplateLibrary, context?: AuditContext): Promise<string> {
  const created = await CodeTemplateService.createLibrary({ name: lib.name, description: lib.description }, context);
  if (!created.ok) throw created.error;
  return created.value.id;
}

async function importTemplate(
  libraryId: string,
  template: MirthCodeTemplate,
  existing: readonly TemplateDetail[],
  overwrite: boolean,
  context?: AuditContext,
): Promise<'created' | 'updated' | 'skipped'> {
  const fields = { type: template.type, code: template.code, contexts: [...template.contexts], description: template.description };
  const match = existing.find((t) => t.name === template.name);
  if (match) {
    if (!overwrite) return 'skipped';
    const updated = await CodeTemplateService.updateTemplate(match.id, { ...fields, revision: match.revision }, context);
    if (!updated.ok) throw updated.error;
    return 'updated';
  }
  const created = await CodeTemplateService.createTemplate(
    { libraryId, name: template.name, language: 'JAVASCRIPT', ...fields }, context,
  );
  if (!created.ok) throw created.error;
  return 'created';
}
