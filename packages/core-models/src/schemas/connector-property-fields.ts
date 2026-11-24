import { z } from 'zod/v4';

/** Digits given as text ("6661", e.g. from a configuration map reference) become a number; nothing else is coerced. */
function digitsToNumber(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
}

/** Digits as text are accepted; `true` is not port 1. */
export const connectorPortSchema = z.preprocess(
  digitsToNumber,
  z.number({
    error: (issue) => (typeof issue.input === 'string' && issue.input.includes('${')
      ? `configuration map reference ${issue.input} did not resolve: no configuration entry has that name`
      : 'must be a port number'),
  }).int().min(1).max(65_535),
);

/** Surrounding spaces are dropped, for what never means them: a host, a queue, a query (D-337). */
export const trimmedTextSchema = z.string().trim().min(1, { message: 'required' });

/** Kept as given, not trimmed. */
export const requiredTextSchema = z.string().refine((value) => value.trim() !== '', { message: 'required' });

export function wholeNumberSchema(min: number, max = Number.MAX_SAFE_INTEGER): z.ZodType<number, unknown> {
  return z.preprocess(digitsToNumber, z.number().int().min(min).max(max));
}

/** The longest delay Node's timers honour; a longer one fires after 1 ms. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Capped at {@link MAX_TIMER_DELAY_MS}: a longer interval makes `setInterval` poll every millisecond. `min` is the receiver's own floor. */
export function pollingIntervalSchema(min: number, defaultMs: number): z.ZodType<number, unknown> {
  return wholeNumberSchema(min, MAX_TIMER_DELAY_MS).default(defaultMs);
}

/** As Node names them. */
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

export const charsetSchema = z.preprocess(
  (value) => (typeof value === 'string' ? CHARSET_ALIASES[value.trim().toLowerCase()] ?? value : value),
  z.enum(CONNECTOR_CHARSETS),
).default('utf-8');

/** `false` reads as null (D-277). */
export function optionalTlsSchema<T extends z.ZodRawShape>(fields: T): z.ZodType {
  return z.preprocess((value) => (value === false ? null : value), z.strictObject(fields).nullable()).optional();
}

/** A non-object passes through so the schema fails it. */
export function withoutKeys(value: unknown, keys: ReadonlySet<string>): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)));
}

/** A whole-object issue (an unknown key) has no path. */
export function formatPropertyIssues(issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }>): string {
  return issues.map((i) => (i.path.length > 0 ? `${i.path.map(String).join('.')}: ${i.message}` : i.message)).join('; ');
}

/** Keys the engine reads from any source connector's properties. */
export const sourceCommonProperties = {
  /** Split an inbound HL7 batch into one message per MSH (set by the Mirth importer). */
  processBatch: z.boolean().optional(),
} as const;

/**
 * Templates the Mirth importer copies that mean "send the message itself",
 * which a destination with no template already does. Sent as written they
 * are text, not the message (a DICOM Sender sent `${DICOMMESSAGE}` as a file
 * path and failed every message).
 */
const MESSAGE_ITSELF_TEMPLATES: Readonly<Record<string, string>> = { DICOM: '${DICOMMESSAGE}' };

/** The engine and the destination schemas both read the template through here, so a Mirth default is dropped in both. */
export function destinationTemplate(connectorType: string, properties: Readonly<Record<string, unknown>>): string | undefined {
  const template = properties['template'];
  if (typeof template !== 'string') return undefined;
  return MESSAGE_ITSELF_TEMPLATES[connectorType] === template ? undefined : template;
}

/** Keys the engine reads from any destination connector's properties. */
export const destinationCommonProperties = {
  /** What to send instead of the encoded message; may use `${...}` (set by the Mirth importer). */
  template: z.string().optional(),
} as const;
