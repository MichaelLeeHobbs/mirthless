// Every `${name}` template uses these (D-275). A caller's look-up checks its
// built-in names before its variables.

const PLACEHOLDER = /\$\{([^}]*)\}/g;

export type PlaceholderLookup = (name: string) => unknown;

/** NaN and Infinity by name, where JSON would write a misleading "null". */
export function placeholderText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return String(JSON.stringify(value));
}

/** A look-up over several sources moves on to the next source when this is false. */
export function hasPlaceholderText(value: unknown): boolean {
  return value !== undefined && value !== null && typeof value !== 'function' && typeof value !== 'symbol';
}

/**
 * A name with no writable value, or an empty name, is left as written, so the
 * mistake shows in what is sent. One pass: a value put in is never scanned for
 * further placeholders.
 */
export function fillPlaceholders(text: string, lookup: PlaceholderLookup): string {
  if (!text.includes('${')) return text;
  return text.replace(PLACEHOLDER, (whole, raw: string) => {
    const name = raw.trim();
    if (name === '') return whole;
    const value = lookup(name);
    return hasPlaceholderText(value) ? placeholderText(value) : whole;
  });
}

/**
 * A look-up over a record's own keys, so `${toString}` does not find the
 * prototype's method.
 */
export function recordLookup(record: Readonly<Record<string, unknown>>): PlaceholderLookup {
  return (name) => (Object.hasOwn(record, name) ? record[name] : undefined);
}

export function placeholderNames(text: string): readonly string[] {
  return [...new Set(Array.from(text.matchAll(PLACEHOLDER), (m) => (m[1] ?? '').trim()))];
}
