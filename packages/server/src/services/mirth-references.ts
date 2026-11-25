// The `${...}` references in an imported connector's settings: which ones GalvaniGraph fills, and when.

import { isPlainObject } from '@galvanigraph/core-util';

/** The built-in names a destination's template fills besides map variables. */
const TEMPLATE_VALUES = ['message.encodedData', 'message.transformedData', 'message.rawData', 'messageId', 'originalFilename'] as const;
const SMTP_VALUES = ['msg', 'messageId', 'channelId', 'metaDataId'] as const;

/** Settings filled for each message, with their built-in names, by destination type; `template` is every type's. */
const PER_MESSAGE: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  HTTP: { url: [], headers: [], parameters: [] },
  SMTP: { subject: SMTP_VALUES, bodyTemplate: SMTP_VALUES, attachments: SMTP_VALUES, from: [], to: [], cc: [], bcc: [] },
  CHANNEL: { targetChannelId: [] },
  DATABASE: { query: [] },
};

/** Names Mirth's template engine defines itself, so a map variable of that name is not what Mirth put there. */
const MIRTH_BUILT_INS: ReadonlySet<string> = new Set([
  'date', 'DATE', 'COUNT', 'UUID', 'SYSTIME', 'HASH', 'XmlUtil', 'JsonUtil', 'maps', 'message', 'channelName', 'channelId', 'originalFilename', 'DICOMMESSAGE',
]);

/** Filled by their own rule, which the deploy checks, or code, where `${...}` is a template literal. */
const CHECKED_ELSEWHERE: ReadonlySet<string> = new Set(['script', 'outputPattern', 'fileNameTemplate']);

const REFERENCE = /\$(!?)\{([^}]*)\}/g;
/** A name a script can have put in a map, and the only form a SQL parameter has. */
const VARIABLE = /^[A-Za-z_]\w*$/;

interface Reference {
  readonly text: string;
  readonly name: string;
  /** Velocity's quiet form, `$!{name}`, which GalvaniGraph sends as written. */
  readonly quiet: boolean;
}

/** The values inside a list or map; anything else as it is. */
function inner(value: unknown): readonly unknown[] {
  return Array.isArray(value) || isPlainObject(value) ? Object.values(value) : [value];
}

function references(value: unknown): readonly Reference[] {
  // Connector settings are text, or lists and maps of it, at most two levels deep.
  return inner(value).flatMap(inner).filter((text) => typeof text === 'string').flatMap((text) =>
    Array.from(text.matchAll(REFERENCE), (m) => ({ text: m[0], name: (m[2] ?? '').trim(), quiet: m[1] === '!' })));
}

export interface ImportedConnector {
  readonly type: string;
  readonly direction: 'source' | 'destination';
  /** As warnings name it: `TCP Sender "Out"`. */
  readonly label: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

/** The built-in names of a setting filled for each message; null for one read once, at deploy. */
function perMessageValues(connector: ImportedConnector, key: string): readonly string[] | null {
  if (connector.direction === 'source') return connector.type === 'DATABASE' && key === 'updateQuery' ? [] : null;
  if (key === 'template') return TEMPLATE_VALUES;
  return PER_MESSAGE[connector.type]?.[key] ?? null;
}

function fillable(reference: Reference, builtIns: readonly string[]): boolean {
  if (reference.quiet) return false;
  if (builtIns.includes(reference.name)) return true;
  return VARIABLE.test(reference.name) && !MIRTH_BUILT_INS.has(reference.name);
}

/** SQL is never filled from the configuration map, and only `updateQuery` and a writer's `query` bind parameters. */
function isFixedSql(connector: ImportedConnector, key: string): boolean {
  return connector.type === 'DATABASE' && key === 'selectQuery';
}

function named(found: ReadonlyMap<string, ReadonlySet<string>>): string {
  return [...found].map(([text, keys]) => `${text} (${[...keys].join(', ')})`).join(', ');
}

function add(found: Map<string, Set<string>>, text: string, key: string): void {
  const keys = found.get(text) ?? new Set<string>();
  found.set(text, keys.add(key));
}

/** The text never quotes a setting, which can hold credentials, only its references. */
export function referenceWarnings(connector: ImportedConnector, channelName: string): string[] {
  const unfilled = new Map<string, Set<string>>();
  const atDeploy = new Map<string, Set<string>>();
  for (const [key, value] of Object.entries(connector.properties)) {
    if (CHECKED_ELSEWHERE.has(key)) continue;
    const builtIns = perMessageValues(connector, key);
    for (const reference of references(value)) {
      if (builtIns === null && !isFixedSql(connector, key) && !reference.quiet) add(atDeploy, reference.text, key);
      else if (builtIns === null || !fillable(reference, builtIns)) add(unfilled, reference.text, key);
    }
  }
  const prefix = `Channel "${channelName}": the ${connector.label} uses`;
  const warnings: string[] = [];
  if (unfilled.size > 0) {
    warnings.push(`${prefix} ${named(unfilled)}, which GalvaniGraph cannot fill and would send as written; set a map variable in a script and use its name`);
  }
  if (atDeploy.size > 0) {
    warnings.push(`${prefix} ${named(atDeploy)}, which GalvaniGraph fills only from the configuration map at deploy, never from a message or script; add the entries first`);
  }
  return warnings;
}

/** A text with Mirth's names for some values changed to GalvaniGraph's. Any other `${...}` stays as written. */
export function renameReferences(text: string, names: Readonly<Record<string, string>>): string {
  return text.replace(/\$\{([^}]*)\}/g, (whole, raw: string) => {
    const name = raw.trim();
    return Object.hasOwn(names, name) ? '${' + String(names[name]) + '}' : whole;
  });
}
