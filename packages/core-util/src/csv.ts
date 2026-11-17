// ===========================================
// CSV
// ===========================================

/**
 * Escape one CSV field per RFC 4180 and neutralize spreadsheet formula
 * injection: a field starting with =, +, -, @, tab, or CR is prefixed with a
 * single quote so Excel/Sheets treat it as text, not a formula. Exported
 * fields (usernames in failed-login events, message metadata) can be
 * attacker-influenced.
 */
export function escapeCsvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}
