// ===========================================
// Configuration map references in connector settings
// ===========================================
// A connector field may name a configuration map entry: `${MIRTH_SENDER_HOST}`
// or `${vns.MIRTH_SENDER_HOST}`. They are resolved when the channel deploys, so
// one export runs against each environment's own hosts and ports.

/** A configuration map entry as the service lists it. */
export interface ConfigEntry {
  readonly category: string;
  readonly name: string;
  readonly value: string | null;
}

const REFERENCE = /\$\{([^}]+)\}/g;

/**
 * Values by `category.name`, and by bare `name` when only one category has
 * that name (a name in two categories is ambiguous and is not resolved bare).
 */
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
 * Settings whose text is code or SQL. A `${name}` there is the language's own
 * (a template literal) or a query parameter the connector binds; inlining a
 * configuration value would change the code or put unescaped text in the SQL.
 */
const CODE_OR_SQL_KEYS: ReadonlySet<string> = new Set(['script', 'query', 'selectQuery', 'updateQuery']);

/**
 * A copy of `properties` with every `${key}` that names a configuration entry
 * replaced by its value, except in code and SQL settings. Any other `${...}`
 * (a message variable such as `${oru}`) is left for the message to fill.
 */
export function resolveConfigReferences(
  properties: Readonly<Record<string, unknown>>,
  lookup: ReadonlyMap<string, string>,
): Record<string, unknown> {
  if (lookup.size === 0) return { ...properties };
  const replace = (text: string): string => text.replace(REFERENCE, (whole, key: string) => lookup.get(key.trim()) ?? whole);
  return JSON.parse(JSON.stringify(properties), (key, value: unknown) =>
    (typeof value === 'string' && !CODE_OR_SQL_KEYS.has(key) ? replace(value) : value)) as Record<string, unknown>;
}
