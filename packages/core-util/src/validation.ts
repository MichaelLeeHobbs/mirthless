// ===========================================
// Zod Validation Utilities
// ===========================================

import { z, type ZodType } from 'zod/v4';
import { stderr, type Result } from 'stderr-lib';

/** True for a non-null, non-array object, such as parsed JSON or XML. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Safely parse a value with a Zod schema, returning a Result */
export function safeParse<T>(schema: ZodType<T>, value: unknown): Result<T> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data, error: null };
  }
  return { ok: false, value: null, error: stderr(z.prettifyError(result.error)) };
}
