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
