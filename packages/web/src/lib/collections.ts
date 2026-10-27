// ===========================================
// Collection UI Helpers
// ===========================================
// Pure helpers for the Collections page (kept out of the component for testing).

/** Render a TTL in seconds as a compact label. */
export function formatTtl(seconds: number | null): string {
  if (seconds === null) return 'Never';
  if (seconds % 86_400 === 0) return `${String(seconds / 86_400)}d`;
  if (seconds % 3_600 === 0) return `${String(seconds / 3_600)}h`;
  if (seconds % 60 === 0) return `${String(seconds / 60)}m`;
  return `${String(seconds)}s`;
}

/** Parse a comma/space separated field list into a deduped, trimmed array. */
export function parseFields(input: string): string[] {
  return [...new Set(input.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.length > 0))];
}

// ----- Records grid -----

/** A grid column the server can sort and search: see `recordColumn` in core-models. */
export type RecordColumn = 'createdAt' | 'expireAt' | 'payload' | `fields.${string}`;

/** The grid column for an indexed field. */
export function fieldColumn(field: string): RecordColumn {
  return `fields.${field}`;
}

/**
 * The sort after clicking a column head: the same column flips direction, a new
 * one starts newest-first for dates and A-Z for text.
 */
export function nextSort(
  current: { readonly sort: RecordColumn; readonly order: 'asc' | 'desc' },
  column: RecordColumn,
): { sort: RecordColumn; order: 'asc' | 'desc' } {
  if (current.sort === column) return { sort: column, order: current.order === 'asc' ? 'desc' : 'asc' };
  const isDate = column === 'createdAt' || column === 'expireAt';
  return { sort: column, order: isDate ? 'desc' : 'asc' };
}

/** The value for an `<input type="datetime-local">` showing this instant in local time. */
export function toDateTimeLocal(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** An ISO instant from a datetime-local value, null when blank, or undefined when unreadable. */
export function fromDateTimeLocal(value: string): string | null | undefined {
  if (value.trim() === '') return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** Indexed field values for a save, leaving out the ones left blank. */
export function filledFields(values: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value.trim() !== '') out[key] = value;
  }
  return out;
}

/** A payload squeezed onto one line for a table cell (HL7 segments are split by \r). */
export function payloadPreview(payload: string | null): string {
  return (payload ?? '').replace(/\s+/g, ' ').trim();
}
