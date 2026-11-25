export const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  LOCK_NOT_AVAILABLE: '55P03',
  DEADLOCK_DETECTED: '40P01',
} as const;

/** Drizzle wraps the Postgres error in `cause`. */
function pgField(err: unknown, name: 'code' | 'constraint'): unknown {
  const own = (err as Record<string, unknown> | null | undefined)?.[name];
  return own ?? ((err as { cause?: unknown } | null | undefined)?.cause as Record<string, unknown> | null | undefined)?.[name];
}

export function pgCode(err: unknown): unknown {
  return pgField(err, 'code');
}

/** The unique constraint a write hit, or null for any other error. */
export function uniqueConstraint(err: unknown): string | null {
  if (pgCode(err) !== PG_ERROR.UNIQUE_VIOLATION) return null;
  const constraint = pgField(err, 'constraint');
  return typeof constraint === 'string' ? constraint : null;
}
