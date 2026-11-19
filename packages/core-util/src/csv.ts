/**
 * RFC 4180 escaping, plus a leading single quote on a field a spreadsheet would
 * run as a formula: exported fields (failed-login usernames, message metadata)
 * can be attacker-influenced.
 */
export function escapeCsvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}
