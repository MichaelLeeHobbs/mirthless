// Configuration map references (`${name}`, `${category.name}`) in connector
// settings resolve at deploy, so one export runs against each environment's own
// hosts and ports.

import { fillPlaceholders } from '@galvanigraph/core-util';

export interface ConfigEntry {
  readonly category: string;
  readonly name: string;
  readonly value: string | null;
}

/** A name in two categories is ambiguous, so it resolves only as `category.name`. */
export function configLookup(entries: readonly ConfigEntry[]): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  const bareCount = new Map<string, number>();
  for (const e of entries) bareCount.set(e.name, (bareCount.get(e.name) ?? 0) + 1);
  for (const e of entries) {
    if (e.value === null) continue;
    lookup.set(`${e.category}.${e.name}`, e.value);
    if (bareCount.get(e.name) === 1) lookup.set(e.name, e.value);
  }
  return lookup;
}

/**
 * A `${name}` in code or SQL is a template literal or a bound query parameter;
 * inlining a value would change the code or put unescaped text in the SQL.
 */
const CODE_OR_SQL_KEYS: ReadonlySet<string> = new Set(['script', 'query', 'selectQuery', 'updateQuery']);

/** A `${...}` that names no entry (a message variable such as `${oru}`) is left for the message to fill. */
export function resolveConfigReferences(
  properties: Readonly<Record<string, unknown>>,
  lookup: Pick<ReadonlyMap<string, string>, 'get' | 'size'>,
): Record<string, unknown> {
  if (lookup.size === 0) return { ...properties };
  const replace = (text: string): string => fillPlaceholders(text, (name) => lookup.get(name));
  return JSON.parse(JSON.stringify(properties), (key, value: unknown) =>
    (typeof value === 'string' && !CODE_OR_SQL_KEYS.has(key) ? replace(value) : value)) as Record<string, unknown>;
}
