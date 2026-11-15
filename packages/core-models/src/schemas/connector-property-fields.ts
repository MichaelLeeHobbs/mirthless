// ===========================================
// Connector Property Fields
// ===========================================
// Field schemas shared by the per-connector property schemas, and the keys
// the engine reads from every source's or every destination's properties
// whatever its connector type.

import { z } from 'zod/v4';

/** Digits given as text ("6661", e.g. from a configuration map reference) become a number; nothing else is coerced. */
function digitsToNumber(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
}

/**
 * A TCP/UDP port, 1 to 65535. Digits as text are accepted (true is not port
 * 1), and a configuration map reference that did not resolve says so.
 */
export const connectorPortSchema = z.preprocess(
  digitsToNumber,
  z.number({
    error: (issue) => (typeof issue.input === 'string' && issue.input.includes('${')
      ? `configuration map reference ${issue.input} did not resolve: no configuration entry has that name`
      : 'must be a port number'),
  }).int().min(1).max(65_535),
);

/** A whole number of at least `min`, digits as text accepted. */
export function wholeNumberSchema(min: number): z.ZodType<number, unknown> {
  return z.preprocess(digitsToNumber, z.number().int().min(min));
}

/**
 * Schema issues as one line: `path: message`, joined by `; `. A whole-object
 * issue (an unknown key) has no path and is just its message.
 */
export function formatPropertyIssues(issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }>): string {
  return issues.map((i) => (i.path.length > 0 ? `${i.path.map(String).join('.')}: ${i.message}` : i.message)).join('; ');
}

/** Keys the engine reads from any source connector's properties. */
export const sourceCommonProperties = {
  /** Split an inbound HL7 batch into one message per MSH (set by the Mirth importer). */
  processBatch: z.boolean().optional(),
} as const;

/** Keys the engine reads from any destination connector's properties. */
export const destinationCommonProperties = {
  /** What to send instead of the encoded message; may use `${...}` (set by the Mirth importer). */
  template: z.string().optional(),
} as const;
