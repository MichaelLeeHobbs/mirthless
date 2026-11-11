// ===========================================
// LIKE Pattern Helpers
// ===========================================

/**
 * Build a "contains" pattern for LIKE / ILIKE from text a user typed. The
 * wildcards `%` and `_` and the escape character `\` are escaped so the text
 * is matched as written (PostgreSQL's default LIKE escape is the backslash).
 */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`;
}
