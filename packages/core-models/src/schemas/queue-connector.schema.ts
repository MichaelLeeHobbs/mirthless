// ===========================================
// Kafka and AMQP Connector Property Schemas
// ===========================================
// Properties of the Kafka and AMQP (RabbitMQ) source and destination
// connectors, as the channel editor saves them. The server validates them at
// deploy and the connector registry parses them, so defaults live here only.
// TLS material is referenced by certificate id; the server replaces the `tls`
// bag with PEM before the connector is built (see connector-tls-resolver.ts).

import { z } from 'zod/v4';

// ----- Shared -----

const port = z.coerce.number().int().min(1).max(65_535);
const required = z.string().trim().min(1);

/** Certificate-store references for a client TLS connection. */
export const clientTlsRefSchema = z.object({
  /** CA used to verify the broker certificate; the system trust store when empty. */
  caCertId: z.string().default(''),
  /** Client certificate and key for mutual TLS (optional). */
  clientCertId: z.string().default(''),
  rejectUnauthorized: z.boolean().default(true),
});

/** Name/value pairs sent with each message; values may use `${name}`. */
const headers = z.record(z.string(), z.string()).default({});

/**
 * How a queue source turns a payload's bytes into message text. `latin1` is
 * ISO-8859-1. `base64` keeps a binary payload (a PDF, an image, Avro) intact
 * as base64 text.
 */
export const QUEUE_CHARSETS = ['utf-8', 'latin1', 'windows-1252', 'base64'] as const;
export type QueueCharset = (typeof QUEUE_CHARSETS)[number];

const charset = z.enum(QUEUE_CHARSETS).default('utf-8');

// ----- Kafka -----

export const KAFKA_SASL_MECHANISMS = ['NONE', 'PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512'] as const;
export type KafkaSaslMechanism = (typeof KAFKA_SASL_MECHANISMS)[number];

/** Where a consumer group with no committed offset starts reading. */
export const KAFKA_START_FROM = ['EARLIEST', 'LATEST'] as const;
export type KafkaStartFrom = (typeof KAFKA_START_FROM)[number];

/** `host:port`, comma separated. */
const brokers = required.refine(
  (value) => value.split(',').every((entry) => /^[^\s:]+:\d{1,5}$/.test(entry.trim())),
  { message: 'must be host:port pairs separated by commas' },
);

const kafkaConnection = {
  brokers,
  clientId: required.default('galvaniflow'),
  useTls: z.boolean().default(false),
  tls: clientTlsRefSchema.optional(),
  saslMechanism: z.enum(KAFKA_SASL_MECHANISMS).default('NONE'),
  saslUsername: z.string().default(''),
  saslPassword: z.string().default(''),
};

/** A SASL mechanism other than NONE needs a username. */
function saslHasUsername(value: { saslMechanism: KafkaSaslMechanism; saslUsername: string }): boolean {
  return value.saslMechanism === 'NONE' || value.saslUsername.length > 0;
}
const saslUsernameIssue = { message: 'SASL needs a username', path: ['saslUsername'] };

export const kafkaSourcePropertiesSchema = z.object({
  ...kafkaConnection,
  topic: required,
  groupId: required,
  startFrom: z.enum(KAFKA_START_FROM).default('EARLIEST'),
  charset,
}).refine(saslHasUsername, saslUsernameIssue);
export type KafkaSourceProperties = z.infer<typeof kafkaSourcePropertiesSchema>;

export const kafkaDestinationPropertiesSchema = z.object({
  ...kafkaConnection,
  /** Topic per message; may use `${name}`. */
  topic: required,
  /**
   * Record key per message; may use `${name}`. Empty sends no key. Not named
   * `key`: secret redaction masks a property of that name (the TLS key PEM).
   */
  messageKey: z.string().default(''),
  headers,
}).refine(saslHasUsername, saslUsernameIssue);
export type KafkaDestinationProperties = z.infer<typeof kafkaDestinationPropertiesSchema>;

// ----- AMQP (RabbitMQ) -----

const amqpConnection = {
  host: required,
  port: port.default(5672),
  vhost: z.string().default('/'),
  username: z.string().default(''),
  password: z.string().default(''),
  useTls: z.boolean().default(false),
  tls: clientTlsRefSchema.optional(),
};

export const amqpSourcePropertiesSchema = z.object({
  ...amqpConnection,
  /** An existing queue; the connector never declares one. */
  queue: required,
  charset,
});
export type AmqpSourceProperties = z.infer<typeof amqpSourcePropertiesSchema>;

export const amqpDestinationPropertiesSchema = z.object({
  ...amqpConnection,
  /** An existing exchange; empty is the default exchange (routing key = queue name). */
  exchange: z.string().default(''),
  /** Routing key per message; may use `${name}`. */
  routingKey: z.string().default(''),
  headers,
  contentType: z.string().default('text/plain'),
});
export type AmqpDestinationProperties = z.infer<typeof amqpDestinationPropertiesSchema>;
