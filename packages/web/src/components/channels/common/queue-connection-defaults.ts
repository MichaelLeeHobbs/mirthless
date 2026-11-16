// ===========================================
// Kafka and AMQP Connection Defaults
// ===========================================
// Shared by the source and destination forms. Keys and values must match the
// defaults in packages/core-models/src/schemas/queue-connector.schema.ts.

/** TLS by certificate id; the server swaps ids for PEM at deploy. */
export const QUEUE_TLS_DEFAULTS: Readonly<Record<string, unknown>> = {
  useTls: false,
  tls: { caCertId: '', clientCertId: '', rejectUnauthorized: true },
};

export const KAFKA_CONNECTION_DEFAULTS: Readonly<Record<string, unknown>> = {
  brokers: '',
  clientId: 'galvanigraph',
  saslMechanism: 'NONE',
  saslUsername: '',
  saslPassword: '',
  ...QUEUE_TLS_DEFAULTS,
};

export const AMQP_CONNECTION_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: '',
  port: 5672,
  vhost: '/',
  username: '',
  password: '',
  ...QUEUE_TLS_DEFAULTS,
};
