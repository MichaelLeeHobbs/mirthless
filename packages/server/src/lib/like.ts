/**
 * Escapes `\`, `%` and `_` so typed text matches as written (PostgreSQL's
 * default LIKE escape is the backslash).
 */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`;
}
