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

/** Text with something other than whitespace in it, kept as given. */
export const requiredTextSchema = z.string().refine((value) => value.trim() !== '', { message: 'required' });

/** A whole number of at least `min` (and at most `max` when given), digits as text accepted. */
export function wholeNumberSchema(min: number, max = Number.MAX_SAFE_INTEGER): z.ZodType<number, unknown> {
  return z.preprocess(digitsToNumber, z.number().int().min(min).max(max));
}

/** The longest delay Node's timers honour; a longer one fires after 1 ms. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * A polling source's milliseconds between polls: a whole number from `min`
 * (the receiver's own floor) to {@link MAX_TIMER_DELAY_MS}, since a longer
 * interval would make `setInterval` poll every millisecond.
 */
export function pollingIntervalSchema(min: number, defaultMs: number): z.ZodType<number, unknown> {
  return wholeNumberSchema(min, MAX_TIMER_DELAY_MS).default(defaultMs);
}

/** Text encodings of a TCP/MLLP or FILE payload, as Node names them. */
export const CONNECTOR_CHARSETS = ['utf-8', 'latin1', 'ascii', 'utf16le'] as const;
export type ConnectorCharset = (typeof CONNECTOR_CHARSETS)[number];

/**
 * Other names for the charsets, matched case-insensitively. The TCP/MLLP and
 * FILE forms saved `UTF-8`, `ISO-8859-1` and `US-ASCII` until 2026-07, and the
 * FILE defaults still save `UTF-8`.
 */
const CHARSET_ALIASES: Readonly<Record<string, ConnectorCharset>> = {
  'utf-8': 'utf-8', utf8: 'utf-8',
  latin1: 'latin1', 'iso-8859-1': 'latin1',
  ascii: 'ascii', 'us-ascii': 'ascii',
  utf16le: 'utf16le', 'utf-16le': 'utf16le',
};

/** A payload charset, `utf-8` by default; other names for one of {@link CONNECTOR_CHARSETS} are mapped onto it. */
export const charsetSchema = z.preprocess(
  (value) => (typeof value === 'string' ? CHARSET_ALIASES[value.trim().toLowerCase()] ?? value : value),
  z.enum(CONNECTOR_CHARSETS),
).default('utf-8');

/** A TLS object with `fields`, or none: absent, null or false (read as null). */
export function optionalTlsSchema<T extends z.ZodRawShape>(fields: T): z.ZodType {
  return z.preprocess((value) => (value === false ? null : value), z.strictObject(fields).nullable()).optional();
}

/** Props without `keys`; anything that is not a plain object passes through to fail the schema. */
export function withoutKeys(value: unknown, keys: ReadonlySet<string>): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)));
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
