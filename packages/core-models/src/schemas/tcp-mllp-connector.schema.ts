// ===========================================
// TCP/MLLP Connector Property Schemas
// ===========================================
// Properties of the TCP/MLLP source and destination, as a channel stores
// them. The server validates them at deploy and the connector registry parses
// them, so defaults live here only. A key not listed here fails validation.
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

/** Optional PEM text. */
const pem = z.string().optional();

/**
 * Frame bytes as hex pairs (`0B`, `1C0D`); MLLP's when both are absent.
 * The connector refuses to build on text that is not hex pairs.
 */
const framing = {
  frameStart: z.string().optional(),
  frameEnd: z.string().optional(),
};

const charset = z.enum(TCP_MLLP_CHARSETS).default('utf-8');

export const tcpMllpSourcePropertiesSchema = z.strictObject({
  host: z.string().default('0.0.0.0'),
  port: connectorPortSchema,
  maxConnections: wholeNumberSchema(1).default(10),
  responseMode: z.enum(TCP_MLLP_RESPONSE_MODES).default('AUTO_ACK'),
  charset,
  maxFrameBytes: wholeNumberSchema(1).default(DEFAULT_MAX_FRAME_BYTES),
  ...framing,
  /** Listener TLS: needs `cert` and `key`; false, null or absent is plaintext. */
  tls: z.union([
    z.literal(false),
    z.null(),
    z.strictObject({ cert: pem, key: pem, ca: pem, requireClientCert: z.boolean().optional() }),
  ]).optional(),
  ...sourceCommonProperties,
});
export type TcpMllpSourceProperties = z.infer<typeof tcpMllpSourcePropertiesSchema>;

export const tcpMllpDestinationPropertiesSchema = z.strictObject({
  host: z.string().trim().min(1),
  port: connectorPortSchema,
  maxConnections: wholeNumberSchema(1).default(5),
  /** Milliseconds to wait for the response. */
  responseTimeout: wholeNumberSchema(1).default(30_000),
  /** Milliseconds to wait for a pooled connection. */
  acquireTimeoutMs: wholeNumberSchema(1).default(30_000),
  charset,
  ...framing,
  /** Client TLS; the certificate is optional, but `cert` and `key` come as a pair. False, null or absent is plaintext. */
  tls: z.union([
    z.literal(false),
    z.null(),
    z.strictObject({ cert: pem, key: pem, ca: pem, rejectUnauthorized: z.boolean().optional() }),
  ]).optional(),
  ...destinationCommonProperties,
});
export type TcpMllpDestinationProperties = z.infer<typeof tcpMllpDestinationPropertiesSchema>;
