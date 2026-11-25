import { DATABASE_VENDOR, type DatabaseVendor } from './database-vendor.js';

/** Comments and quoted text. MySQL escapes with a backslash, PostgreSQL only in E'' strings. */
const NOT_CODE: Readonly<Record<DatabaseVendor, RegExp>> = {
  [DATABASE_VENDOR.POSTGRESQL]: /--[^\n]*|\/\*[\s\S]*?\*\/|\b[eE]'(?:[^'\\]|''|\\[\s\S])*'|'(?:[^']|'')*'|"(?:[^"]|"")*"|\$(\w*)\$[\s\S]*?\$\1\$/g,
  [DATABASE_VENDOR.MYSQL]: /--(?=\s|$)[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|''|\\[\s\S])*'|"(?:[^"\\]|""|\\[\s\S])*"|`(?:[^`]|``)*`/g,
};

/** The query, of the same length, with comments blank and quoted text as `x`. */
function codeOnly(sql: string, vendor: DatabaseVendor): string {
  return sql.replace(NOT_CODE[vendor], (found) => (/^(?:--|#|\/\*)/.test(found) ? ' ' : 'x').repeat(found.length));
}

function inParentheses(code: string, index: number): boolean {
  const before = code.slice(0, index);
  return before.split('(').length > before.split(')').length;
}

/**
 * The SELECT as a poll sends it, so that two sources cannot take one row. A query with a
 * FOR UPDATE of its own is left as it is. FOR SHARE lets both read the row, so it becomes
 * FOR UPDATE, with the tables and the waiting it asks for.
 *
 * Locks hold only for a plain SELECT (one table, no GROUP BY/DISTINCT/aggregate). PostgreSQL
 * rejects any other with this clause, and the failure is logged rather than reopening double
 * processing.
 */
export function appendLockClause(selectQuery: string, vendor: DatabaseVendor = DATABASE_VENDOR.POSTGRESQL): string {
  const trimmed = selectQuery.trim();
  const code = codeOnly(trimmed, vendor);
  // A comment at the end would hide a clause put after it.
  const sql = trimmed.slice(0, code.replace(/[\s;]+$/, '').length);
  if (/\bfor\s+update\b/i.test(code)) return sql;
  const locked = sql.replace(/\bfor\s+share\b/gi, (found: string, index: number) =>
    (/^for\s+share$/i.test(code.slice(index, index + found.length)) && !inParentheses(code, index) ? 'FOR UPDATE' : found));
  return locked === sql ? `${sql} FOR UPDATE SKIP LOCKED` : locked;
}
