// ===========================================
// Script reference
// ===========================================
// The globals and code templates a script can use, read from the same
// declarations the type checker uses, so the reference cannot drift from what
// completion offers or what the engine provides.

import { scriptDeclarations, templateDeclarations, type ScriptSurface, type TemplateSource } from '@galvaniflow/core-models';

export type ReferenceGroup = 'Message' | 'Maps' | 'Functions' | 'Code templates';

/** One thing a script can use. */
export interface ReferenceEntry {
  readonly name: string;
  readonly group: ReferenceGroup;
  /** Each overload's signature, e.g. `parseHL7(raw: string): Hl7MessageProxy`. */
  readonly signatures: readonly string[];
  /** The first paragraph of its documentation. */
  readonly doc: string;
  /** Monaco snippet text: a call with a placeholder for each parameter, or the name. */
  readonly snippet: string;
}

const MESSAGE_VARS = new Set(['msg', 'tmp', 'rawData', 'destinationSet', 'logger']);

/** The first paragraph of a JSDoc body, without `*` gutters or @tags. */
function docSummary(raw: string | undefined): string {
  if (!raw) return '';
  const lines = raw.split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim());
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith('@') || (line === '' && out.length > 0)) break;
    if (line !== '') out.push(line);
  }
  return out.join(' ');
}

/** `(raw: string, ackCode?: string)` → `${1:raw}, ${2:ackCode}`. */
function paramPlaceholders(params: string): string {
  const names = params
    .split(',')
    .map((p) => p.trim().replace(/^\.\.\./, '').split(/[?:=\s]/)[0] ?? '')
    .filter((n) => /^[\w$]+$/.test(n));
  return names.map((n, i) => `\${${String(i + 1)}:${n}}`).join(', ');
}

function groupFor(kind: 'function' | 'var', name: string): ReferenceGroup {
  if (kind === 'var') return MESSAGE_VARS.has(name) ? 'Message' : 'Maps';
  return name.startsWith('$') ? 'Maps' : 'Functions';
}

// A doc comment's body may not contain `*/`, so a match never runs from an
// earlier comment across other declarations to this one.
const DOC = String.raw`(?:\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*)?`;
const DECLARATION = new RegExp(`${DOC}declare\\s+(function|var)\\s+([\\w$]+)([^;]*);`, 'g');
const TEMPLATE_FUNCTION = new RegExp(`${DOC}function\\s+([\\w$]+)\\s*\\(([^)]*)\\)`, 'g');

/** Sandbox globals and code templates for a script surface, sorted by group then name. */
export function scriptReference(surface: ScriptSurface, templates: readonly TemplateSource[]): ReferenceEntry[] {
  const byName = new Map<string, { group: ReferenceGroup; signatures: string[]; doc: string; snippet: string }>();
  for (const m of scriptDeclarations(surface).matchAll(DECLARATION)) {
    const [, doc, kind, name, rest] = m as unknown as [string, string | undefined, 'function' | 'var', string, string];
    const signature = kind === 'function' ? `${name}${rest.trim()}` : `${name}${rest.trim()}`;
    const existing = byName.get(name);
    if (existing) { existing.signatures.push(signature); continue; }
    const params = kind === 'function' ? /^\s*\(([^)]*)\)/.exec(rest)?.[1] ?? '' : '';
    byName.set(name, {
      group: groupFor(kind, name),
      signatures: [signature],
      doc: docSummary(doc),
      snippet: kind === 'function' ? `${name}(${paramPlaceholders(params)})` : name,
    });
  }
  for (const m of templateDeclarations(templates, surface).matchAll(TEMPLATE_FUNCTION)) {
    const [, doc, name, params] = m as unknown as [string, string | undefined, string, string];
    byName.set(name, {
      group: 'Code templates',
      signatures: [`${name}(${params.trim()})`],
      doc: docSummary(doc),
      snippet: `${name}(${paramPlaceholders(params)})`,
    });
  }
  const order: readonly ReferenceGroup[] = ['Message', 'Functions', 'Code templates', 'Maps'];
  return [...byName.entries()]
    .map(([name, e]) => ({ name, ...e }))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.name.localeCompare(b.name));
}
