export function formatTtl(seconds: number | null): string {
  if (seconds === null) return 'Never';
  if (seconds % 86_400 === 0) return `${String(seconds / 86_400)}d`;
  if (seconds % 3_600 === 0) return `${String(seconds / 3_600)}h`;
  if (seconds % 60 === 0) return `${String(seconds / 60)}m`;
  return `${String(seconds)}s`;
}

/** A script no longer finds it; an administrator still sees it, and can give it a new life. */
export function isExpired(expireAt: string | null, now: number = Date.now()): boolean {
  return expireAt !== null && Date.parse(expireAt) <= now;
}

export function parseFields(input: string): string[] {
  return [...new Set(input.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.length > 0))];
}

/** Mirrors `recordColumn` in core-models. */
export type RecordColumn = 'createdAt' | 'expireAt' | 'payload' | `fields.${string}`;

export function fieldColumn(field: string): RecordColumn {
  return `fields.${field}`;
}

export function nextSort(
  current: { readonly sort: RecordColumn; readonly order: 'asc' | 'desc' },
  column: RecordColumn,
): { sort: RecordColumn; order: 'asc' | 'desc' } {
  if (current.sort === column) return { sort: column, order: current.order === 'asc' ? 'desc' : 'asc' };
  const isDate = column === 'createdAt' || column === 'expireAt';
  return { sort: column, order: isDate ? 'desc' : 'asc' };
}

export function filledFields(values: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value.trim() !== '') out[key] = value;
  }
  return out;
}

/** HL7 segments end in \r, which `\s` also folds. */
export function payloadPreview(payload: string | null): string {
  return (payload ?? '').replace(/\s+/g, ' ').trim();
}
