// ===========================================
// TCP/MLLP Connector Property Schemas
// ===========================================
// Properties of the TCP/MLLP source and destination, as a channel stores
// them. The server validates them at deploy and the connector registry parses
// them, so defaults live here only. A key not listed here fails validation,
// except the keys this app's own editor used to save (LEGACY_KEYS), which
// are dropped.
//
// TLS is inline PEM in a `tls` object: TCP/MLLP has no certificate-store
// lookup yet. Here `tls` is only typed; the connectors package decides
// whether the PEM fields form a usable key pair (packages/connectors/src/tls.ts).

import { z } from 'zod/v4';
import {
  connectorPortSchema,
  wholeNumberSchema,
  sourceCommonProperties,
  destinationCommonProperties,
  optionalTlsSchema,
  withoutKeys,
} from './connector-property-fields.js';

/** Payload encodings, as Node names them. */
export const TCP_MLLP_CHARSETS = ['utf-8', 'latin1', 'ascii', 'utf16le'] as const;
export type TcpMllpCharset = (typeof TCP_MLLP_CHARSETS)[number];

/** AUTO_ACK builds an HL7 ACK/NAK from the inbound message; PASSTHROUGH relays the channel's response. */
export const TCP_MLLP_RESPONSE_MODES = ['AUTO_ACK', 'PASSTHROUGH'] as const;
export type TcpMllpResponseMode = (typeof TCP_MLLP_RESPONSE_MODES)[number];

/**
 * Largest message a TCP/MLLP connection may buffer. Unauthenticated network
 * input must be bounded against memory exhaustion; 50 MiB exceeds any
 * realistic HL7v2 message.
 */
export const DEFAULT_MAX_FRAME_BYTES = 50 * 1024 * 1024;

/**
 * Keys the TCP/MLLP forms saved from 2026-02 (58ab3ae) to 2026-07 (349a666).
 * No connector ever read them, and an edit keeps them, so saved channels still
 * carry them. They are dropped rather than rejected.
 */
const LEGACY_KEYS: ReadonlySet<string> = new Set(['receiveTimeout', 'bufferSize', 'keepConnectionOpen', 'transmissionMode', 'sendTimeout']);

/**
 * Other names for the charsets, matched case-insensitively. The same editor
 * saved `UTF-8`, `ISO-8859-1` and `US-ASCII`.
 */
const CHARSET_ALIASES: Readonly<Record<string, TcpMllpCharset>> = {
  'utf-8': 'utf-8', utf8: 'utf-8',
  latin1: 'latin1', 'iso-8859-1': 'latin1',
  ascii: 'ascii', 'us-ascii': 'ascii',
  utf16le: 'utf16le', 'utf-16le': 'utf16le',
};

/** Props without the legacy keys. */
function dropLegacyKeys(value: unknown): unknown {
  return withoutKeys(value, LEGACY_KEYS);
}

const charset = z.preprocess(
  (value) => (typeof value === 'string' ? CHARSET_ALIASES[value.trim().toLowerCase()] ?? value : value),
  z.enum(TCP_MLLP_CHARSETS),
).default('utf-8');

/** Optional PEM text; null is unset, as the connector reads it. */
const pem = z.string().nullable().optional();

/**
 * Frame bytes as hex pairs (`0B`, `1C0D`); MLLP's when both are absent.
 * The connector refuses to build on text that is not hex pairs.
 */
const framing = {
  frameStart: z.string().optional(),
  frameEnd: z.string().optional(),
};

/** The source's keys; the docs guard compares them with the connector reference. */
export const tcpMllpSourceObjectSchema = z.strictObject({
  host: z.string().default('0.0.0.0'),
  port: connectorPortSchema,
  maxConnections: wholeNumberSchema(1).default(10),
  responseMode: z.enum(TCP_MLLP_RESPONSE_MODES).default('AUTO_ACK'),
  charset,
  maxFrameBytes: wholeNumberSchema(1).default(DEFAULT_MAX_FRAME_BYTES),
  ...framing,
  /** Listener TLS: needs `cert` and `key`. */
  tls: optionalTlsSchema({ cert: pem, key: pem, ca: pem, requireClientCert: z.boolean().nullable().optional() }),
  ...sourceCommonProperties,
});

/** The destination's keys; the docs guard compares them with the connector reference. */
export const tcpMllpDestinationObjectSchema = z.strictObject({
  host: z.string().trim().min(1),
  port: connectorPortSchema,
  maxConnections: wholeNumberSchema(1).default(5),
  /** Milliseconds to wait for the response. */
  responseTimeout: wholeNumberSchema(1).default(30_000),
  /** Milliseconds to wait for a pooled connection. */
  acquireTimeoutMs: wholeNumberSchema(1).default(30_000),
  charset,
  ...framing,
  /** Client TLS; the certificate is optional, but `cert` and `key` come as a pair. */
  tls: optionalTlsSchema({ cert: pem, key: pem, ca: pem, rejectUnauthorized: z.boolean().nullable().optional() }),
  ...destinationCommonProperties,
});

export const tcpMllpSourcePropertiesSchema = z.preprocess(dropLegacyKeys, tcpMllpSourceObjectSchema);
export type TcpMllpSourceProperties = z.infer<typeof tcpMllpSourceObjectSchema>;

export const tcpMllpDestinationPropertiesSchema = z.preprocess(dropLegacyKeys, tcpMllpDestinationObjectSchema);
export type TcpMllpDestinationProperties = z.infer<typeof tcpMllpDestinationObjectSchema>;
