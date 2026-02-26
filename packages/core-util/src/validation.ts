// ===========================================
// Zod Validation Utilities
// ===========================================

import { z, type ZodType } from 'zod/v4';
import { stderr, type Result } from 'stderr-lib';

/** Safely parse a value with a Zod schema, returning a Result */
export function safeParse<T>(schema: ZodType<T>, value: unknown): Result<T> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data, error: null };
  }
  return { ok: false, value: null, error: stderr(z.prettifyError(result.error)) };
}
