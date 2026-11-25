import { DATABASE_VENDOR, type DatabaseVendor } from './database-vendor.js';

/** Comments and quoted text. MySQL escapes with a backslash, PostgreSQL only in E'' strings. */
const NOT_CODE: Readonly<Record<DatabaseVendor, RegExp>> = {
  [DATABASE_VENDOR.POSTGRESQL]: /--[^\n]*|\/\*[\s\S]*?\*\/|\b[eE]'(?:[^'\\]|''|\\[\s\S])*'|'(?:[^']|'')*'|"(?:[^"]|"")*"|\$(\w*)\$[\s\S]*?\$\1\$/g,
  [DATABASE_VENDOR.MYSQL]: /--(?=\s|$)[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|''|\\[\s\S])*'|"(?:[^"\\]|""|\\[\s\S])*"|`(?:[^`]|``)*`/g,
};
/** What stands before the parenthesis of a query whose rows are the outer query's: a CTE, a derived table, a query in parentheses. */
const OPENS_A_SOURCE = /(?:^|\(|\b(?:from|join|lateral|as|materialized|all|union|intersect|except))$/i;
const SELECTS = /^[\s(]*(?:select|with|table|values)\b/i;

/** The query, of the same length, with comments blank and quoted text as `x`. */
function codeOnly(sql: string, vendor: DatabaseVendor): string {
  return sql.replace(NOT_CODE[vendor], (found) => (/^(?:--|#|\/\*)/.test(found) ? ' ' : 'x').repeat(found.length));
}

/** Without what can stand after a query: space, semicolons, and the comments that codeOnly blanked. */
function codeLength(code: string): number {
  let end = code.length;
  while (end > 0 && /[\s;]/.test(code[end - 1] ?? '')) end -= 1;
  return end;
}

/** Whether a lock here holds the rows the query returns: not in a subquery of a condition or a column. */
function locksReturnedRows(code: string, index: number): boolean {
  let closed = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (code[i] === ')') closed += 1;
    if (code[i] !== '(') continue;
    if (closed > 0) closed -= 1;
    else if (!OPENS_A_SOURCE.test(code.slice(Math.max(0, i - 100), i).trimEnd())) return false;
  }
  return true;
}

function shareToUpdate(sql: string, code: string): string {
  return sql.replace(/\bfor\s+share\b/gi, (found: string, index: number) => {
    const isCode = /^for\s+share$/i.test(code.slice(index, index + found.length));
    return isCode && (!SELECTS.test(code) || locksReturnedRows(code, index)) ? 'FOR UPDATE' : found;
  });
}

/**
 * The SELECT as a poll sends it, so that two sources cannot take one row. A query with a
 * FOR UPDATE of its own is left as it is. FOR SHARE lets both read the row, so it becomes
 * FOR UPDATE, with the tables and the waiting it asks for.
 *
 * The added lock holds the rows of the tables the query itself reads. PostgreSQL rejects it on
 * GROUP BY, DISTINCT or an aggregate, and the failure is logged rather than reopening double
 * processing. Rows of a WITH query, and on MySQL of a derived table, are not held by it and
 * nothing says so: such a query needs its own FOR UPDATE in there.
 */
export function appendLockClause(selectQuery: string, vendor: DatabaseVendor = DATABASE_VENDOR.POSTGRESQL): string {
  const trimmed = selectQuery.trim();
  const code = codeOnly(trimmed, vendor);
  // A comment at the end would hide a clause put after it.
  const sql = trimmed.slice(0, codeLength(code));
  if (/\bfor\s+update\b/i.test(code)) return sql;
  const locked = shareToUpdate(sql, code);
  return locked === sql ? `${sql} FOR UPDATE SKIP LOCKED` : locked;
}

/** The query with the rows that another transaction holds; the same query when it skips none. */
export function withSkippedRows(lockingQuery: string, vendor: DatabaseVendor): string {
  const code = codeOnly(lockingQuery, vendor);
  let all = '';
  let copied = 0;
  for (const found of code.matchAll(/\bfor\s+(?:update|share)\b[^()]*?\bskip\s+locked\b/gi)) {
    all += lockingQuery.slice(copied, found.index);
    copied = found.index + found[0].length;
  }
  return all + lockingQuery.slice(copied);
}
