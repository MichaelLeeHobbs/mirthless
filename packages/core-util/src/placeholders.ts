// ===========================================
// ${name} placeholders
// ===========================================
// One rule for every setting or template that names a value as `${name}`:
// connector settings, File/SFTP output names, SMTP and alert templates,
// destination templates and configuration references. Each caller supplies
// its own look-up (its built-in names first, then its variables).

/** Any `${...}`; the text between the braces, trimmed, is the name. */
const PLACEHOLDER = /\$\{([^}]*)\}/g;

/** Returns the value for a placeholder name, or undefined when there is none. */
export type PlaceholderLookup = (name: string) => unknown;

/**
 * The text a placeholder's value is written as: a string as it is, a number or
 * bigint as its digits (NaN and Infinity by name, where JSON would write a
 * misleading "null"), anything else as JSON.
 */
export function placeholderText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return String(JSON.stringify(value));
}

/** A value with text worth writing; a function or symbol has none. */
function hasText(value: unknown): boolean {
  return value !== undefined && value !== null && typeof value !== 'function' && typeof value !== 'symbol';
}

/**
 * Fill each `${name}` in `text` from `lookup(name)`, with the name trimmed. A
 * name with no value (undefined, null, a function or a symbol), or an empty
 * name, is left as written, so a mistake shows in what is sent. One pass: a value put in is
 * never scanned for further placeholders.
 */
export function fillPlaceholders(text: string, lookup: PlaceholderLookup): string {
  if (!text.includes('${')) return text;
  return text.replace(PLACEHOLDER, (whole, raw: string) => {
    const name = raw.trim();
    if (name === '') return whole;
    const value = lookup(name);
    return hasText(value) ? placeholderText(value) : whole;
  });
}

/**
 * A look-up over a record's own keys, so `${toString}` does not find the
 * prototype's method.
 */
export function recordLookup(record: Readonly<Record<string, unknown>>): PlaceholderLookup {
  return (name) => (Object.hasOwn(record, name) ? record[name] : undefined);
}

/** The trimmed names of the `${...}` placeholders in `text`, each once, in order. */
export function placeholderNames(text: string): readonly string[] {
  return [...new Set(Array.from(text.matchAll(PLACEHOLDER), (m) => (m[1] ?? '').trim()))];
}
