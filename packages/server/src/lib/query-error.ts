// Drizzle's error for a failed statement holds its parameters, which are
// passwords and message content, in its message, its stack and a property, and
// error text is logged, sent in alerts and stored with messages. Importing this
// file replaces that error wherever Drizzle runs a statement; every file that
// makes a Drizzle client imports it. Drizzle has no setting for it.

import { DrizzleQueryError } from 'drizzle-orm';
import { PgPreparedQuery } from 'drizzle-orm/pg-core';

/** Never the database's own message, which can quote a value (`invalid input syntax for type integer: "..."`). */
function reason(cause: unknown): string {
  if (typeof cause !== 'object' || cause === null) return '';
  const { code, constraint } = cause as { readonly code?: unknown; readonly constraint?: unknown };
  // Without a code it is the driver's own error, such as a lost connection.
  const parts = typeof code === 'string' ? [code, constraint] : [cause instanceof Error ? cause.message : undefined];
  const text = parts.filter((part) => typeof part === 'string').join(', ');
  return text === '' ? '' : ` (${text})`;
}

/** What Postgres quotes values in. Nothing reads them; what prints an error prints its cause too. */
const QUOTES_VALUES = ['detail', 'where', 'internalQuery'] as const;

/** The same object, so what reads its code or constraint still does. */
function withoutQuotedValues(cause: unknown): unknown {
  if (typeof cause === 'object' && cause !== null) for (const key of QUOTES_VALUES) Reflect.deleteProperty(cause, key);
  return cause;
}

/** `cause` is the database's or the driver's error. Its message can quote a value: never log it. */
export class QueryError extends Error {
  constructor(query: string, cause: unknown) {
    super(`Failed query${reason(cause)}: ${query}`, { cause: withoutQuotedValues(cause) });
    this.name = 'QueryError';
  }
}

interface PreparedQueryInternals {
  queryWithCache?: (this: unknown, query: string, params: unknown[], run: () => Promise<unknown>) => Promise<unknown>;
}

// Assertion: Drizzle marks the method @internal, so its types leave it out.
const internals = PgPreparedQuery.prototype as unknown as PreparedQueryInternals;
const runStatement = internals.queryWithCache;
if (runStatement === undefined) throw new Error('This version of Drizzle runs statements another way: its errors would put parameters in the log');

internals.queryWithCache = async function queryWithCache(query, params, run): Promise<unknown> {
  try {
    return await runStatement.call(this, query, params, run);
  } catch (err: unknown) {
    throw err instanceof DrizzleQueryError ? new QueryError(err.query, err.cause) : err;
  }
};
