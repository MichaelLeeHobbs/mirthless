import { DATABASE_VENDOR, type DatabaseVendor } from './database-vendor.js';

/** Comments and quoted text. MySQL escapes with a backslash, PostgreSQL only in E'' strings. */
const NOT_CODE: Readonly<Record<DatabaseVendor, RegExp>> = {
  [DATABASE_VENDOR.POSTGRESQL]: /--[^\n]*|\/\*[\s\S]*?\*\/|\b[eE]'(?:[^'\\]|''|\\[\s\S])*'|'(?:[^']|'')*'|"(?:[^"]|"")*"|\$(\w*)\$[\s\S]*?\$\1\$/g,
  [DATABASE_VENDOR.MYSQL]: /--(?=\s|$)[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|''|\\[\s\S])*'|"(?:[^"\\]|""|\\[\s\S])*"|`(?:[^`]|``)*`/g,
};
/**
 * What stands before the parenthesis of a query whose rows are the outer query's: a CTE, a derived table, a query in
 * parentheses. `> ALL (` and `IS DISTINCT FROM (` open a condition's subquery, so ALL counts only after a set operator.
 */
const OPENS_A_SOURCE = /(?:^|\(|\b(?:join|lateral|as|materialized|union|intersect|except)|\b(?:union|intersect|except)\s+all|(?<!\bdistinct\s+)\bfrom)$/i;
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

/** What stands before each parenthesis that is open here, the innermost first, from `from` on. */
function openParentheses(code: string, index: number, from = 0): readonly string[] {
  const before: string[] = [];
  let closed = 0;
  for (let i = index - 1; i >= from; i -= 1) {
    if (code[i] === ')') closed += 1;
    if (code[i] !== '(') continue;
    if (closed > 0) closed -= 1;
    else before.push(code.slice(0, i).trimEnd());
  }
  return before;
}

/**
 * The SELECT as a poll sends it, so that two sources cannot take one row. A query with a
 * FOR UPDATE of its own is left as it is. FOR SHARE lets both read the row, so it becomes
 * FOR UPDATE, with the tables and the waiting it asks for, unless it is in a subquery of a
 * condition or a column, whose rows are not the query's.
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

  const selects = SELECTS.test(code);
  let claims = false;
  const locked = sql.replace(/\bfor\s+share\b/gi, (found: string, index: number) => {
    const isCode = /^for\s+share$/i.test(code.slice(index, index + found.length));
    const open = isCode ? openParentheses(code, index) : [];
    if (!isCode || (selects && !open.every((before) => OPENS_A_SOURCE.test(before)))) return found;
    claims ||= !selects || open.every((before) => /^[\s(]*$/.test(before));
    return 'FOR UPDATE';
  });
  return claims ? locked : `${locked} FOR UPDATE SKIP LOCKED`;
}

const LOCK_CLAUSE = /\bfor\s+(?:no\s+key\s+update|key\s+share|update|share)\b(?:\s+of\s+[\w$.]+(?:\s*,\s*[\w$.]+)*)?(?:\s+(?:nowait|skip\s+locked))?/gi;

/** The query without its locks, so with the rows that another transaction holds; the same query when its locks skip none. */
export function withSkippedRows(lockingQuery: string, vendor: DatabaseVendor): string {
  const code = codeOnly(lockingQuery, vendor);
  if (!/\bskip\s+locked\b/i.test(code)) return lockingQuery;
  let all = '';
  let copied = 0;
  for (const found of code.matchAll(LOCK_CLAUSE)) {
    all += lockingQuery.slice(copied, found.index);
    copied = found.index + found[0].length;
  }
  return all + lockingQuery.slice(copied);
}

interface Parenthesis {
  readonly open: number;
  readonly close: number;
  readonly before: string;
}

/** Every pair of parentheses in the code. One left open runs to the end. */
function parenthesesOf(code: string): readonly Parenthesis[] {
  const found: Parenthesis[] = [];
  const opened: number[] = [];
  const pair = (open: number, close: number): Parenthesis => ({ open, close, before: code.slice(0, open).trimEnd() });
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === '(') opened.push(i);
    const open = code[i] === ')' ? opened.pop() : undefined;
    if (open !== undefined) found.push(pair(open, i));
  }
  return [...found, ...opened.map((open) => pair(open, code.length))];
}

/** Whether the lock at `index` holds the rows that the query in `scope` (null: the whole query) reads. */
function holdsRowsOf(code: string, index: number, scope: Parenthesis | null): boolean {
  if (scope !== null && (index <= scope.open || index >= scope.close)) return false;
  return openParentheses(code, index, scope === null ? 0 : scope.open + 1).every((before) => OPENS_A_SOURCE.test(before));
}

/** Only locks that two sources cannot both hold: FOR SHARE has become FOR UPDATE where it claims, and KEY SHARE never claims. */
const CLAIMS = /\bfor\s+(?:no\s+key\s+)?update\b/gi;
const CLAIMS_OF = /\bfor\s+(?:no\s+key\s+)?update\s+of\b/i;
/** The body of a WITH query: what follows its AS, or AS [NOT] MATERIALIZED. */
const OPENS_A_WITH_QUERY = /\b(?:as|materialized)$/i;
/** On MySQL, a query that may be in FROM or JOIN, which a lock outside it does not reach. After a comma it may be a column. */
const OPENS_A_DERIVED_TABLE = /(?:\b(?:from|join|straight_join|lateral)|[,(])$/i;
const COMBINES = /\b(?:union|intersect|except)\b/i;

/**
 * Why the lock a poll sends may hold none of the rows its query returns, so that two sources can take
 * one row (#445); null when it holds them. Read from the text alone, it errs towards a reason: a query
 * whose WITH query only filters a table the main query reads is named, and a view or a function in
 * FROM is not seen.
 */
export function unheldRowsReason(selectQuery: string, vendor: DatabaseVendor = DATABASE_VENDOR.POSTGRESQL): string | null {
  const code = codeOnly(appendLockClause(selectQuery, vendor), vendor);
  if (!SELECTS.test(code)) return null;
  const claims = [...code.matchAll(CLAIMS)].map((m) => m.index);
  const locked = (scope: Parenthesis | null): boolean => claims.some((at) => holdsRowsOf(code, at, scope));
  const queries = parenthesesOf(code).filter((p) => SELECTS.test(code.slice(p.open + 1, p.close)));

  if (!locked(null)) return 'its only lock is in a subquery of a condition or a column, or is one that other sources can hold too';
  if (queries.some((p) => OPENS_A_WITH_QUERY.test(p.before) && !locked(p))) {
    return 'it reads through a WITH query, and a lock outside that query does not hold its rows';
  }
  if (vendor === DATABASE_VENDOR.MYSQL && queries.some((p) => OPENS_A_DERIVED_TABLE.test(p.before) && !locked(p))) {
    return 'it has a subquery after FROM, JOIN or a comma with no lock of its own, and on MySQL a lock outside a subquery in FROM does not hold its rows';
  }
  if (COMBINES.test(code)) return 'it combines queries with UNION, INTERSECT or EXCEPT, and a lock holds the rows of one of them at most';
  if (CLAIMS_OF.test(code)) return 'its lock names tables with OF, and holds only the rows of those tables';
  return null;
}
