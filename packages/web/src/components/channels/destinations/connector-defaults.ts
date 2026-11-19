import type { DestinationFormValues } from './types.js';
import { createDefaultFilter, createDefaultTransformer } from '../source/types.js';
import { NEW_SCRIPT_LANGUAGE } from '../../../lib/script-language.js';
import { KAFKA_CONNECTION_DEFAULTS, AMQP_CONNECTION_DEFAULTS } from '../common/queue-connection-defaults.js';

// Keys must match what packages/connectors/src/registry.ts reads for each type.
// The TcpMllpDispatcher consumes host/port/maxConnections/responseTimeout/
// acquireTimeoutMs/charset (TLS is resolved server-side and not surfaced here yet).
// charset must be a valid Node BufferEncoding token: the registry casts it
// straight to BufferEncoding with no normalization.
export const TCP_MLLP_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: 'localhost',
  port: 6661,
  maxConnections: 5,
  responseTimeout: 30000,
  acquireTimeoutMs: 30000,
  charset: 'utf-8',
};

export const HTTP_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  url: 'http://localhost:8080',
  method: 'POST',
  headers: {},
  contentType: 'text/plain',
  responseTimeout: 30000,
  // TLS by certificate id; the server resolves ids to PEM at deploy. No raw PEM is stored here.
  scheme: 'HTTP',
  tls: { caCertId: '', clientCertId: '', rejectUnauthorized: true },
};

export const FILE_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  directory: '',
  outputPattern: '${messageId}.txt',
  charset: 'utf-8',
  binary: false,
  tempFileEnabled: true,
  appendMode: false,
};

export const DATABASE_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: 'localhost',
  port: 5432,
  database: '',
  username: '',
  password: '',
  tls: false,
  query: '',
  useTransaction: false,
  returnGeneratedKeys: false,
};

export const JAVASCRIPT_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  script: '',
  scriptLanguage: NEW_SCRIPT_LANGUAGE,
};

export const SMTP_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: '',
  port: 587,
  secure: false,
  requireTLS: false,
  authUser: '',
  authPass: '',
  from: '',
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  bodyTemplate: '${msg}',
  contentType: 'text/plain',
  attachContent: false,
  attachments: [],
};

export const CHANNEL_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  targetChannelId: '',
  waitForResponse: false,
};

export const FHIR_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  baseUrl: '',
  resourceType: 'Patient',
  method: 'POST',
  authType: 'NONE',
  authUsername: '',
  authPassword: '',
  authToken: '',
  authHeaderName: '',
  authApiKey: '',
  format: 'json',
  timeout: 30000,
  headers: {},
};

export const DICOM_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: 'localhost',
  port: 104,
  calledAETitle: 'PACS',
  callingAETitle: 'GALVANIGRAPH',
  maxRetries: 3,
  retryDelayMs: 1000,
  timeoutMs: 30000,
};

// Keys must match exactly what the SFTP destination connector reads (packages/connectors/src/sftp).
export const SFTP_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: '',
  port: 22,
  username: '',
  password: '',
  privateKey: '',
  passphrase: '',
  remoteDirectory: '',
  fileNameTemplate: '${messageId}.dat',
  appendMode: false,
  strictHostKey: true,
  hostKey: '',
};

export const KAFKA_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  ...KAFKA_CONNECTION_DEFAULTS,
  topic: '',
  messageKey: '',
  headers: {},
};

export const AMQP_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  ...AMQP_CONNECTION_DEFAULTS,
  exchange: '',
  routingKey: '',
  headers: {},
  contentType: 'text/plain',
};

const DEFAULTS_MAP: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  TCP_MLLP: TCP_MLLP_DEST_DEFAULTS,
  HTTP: HTTP_DEST_DEFAULTS,
  FILE: FILE_DEST_DEFAULTS,
  DATABASE: DATABASE_DEST_DEFAULTS,
  JAVASCRIPT: JAVASCRIPT_DEST_DEFAULTS,
  SMTP: SMTP_DEST_DEFAULTS,
  CHANNEL: CHANNEL_DEST_DEFAULTS,
  FHIR: FHIR_DEST_DEFAULTS,
  DICOM: DICOM_DEST_DEFAULTS,
  SFTP: SFTP_DEST_DEFAULTS,
  KAFKA: KAFKA_DEST_DEFAULTS,
  AMQP: AMQP_DEST_DEFAULTS,
};

export function getDestDefaultProperties(connectorType: string): Record<string, unknown> {
  return { ...(DEFAULTS_MAP[connectorType] ?? {}) };
}

export function createDefaultDestination(index: number): DestinationFormValues {
  return {
    name: `Destination ${String(index + 1)}`,
    enabled: true,
    connectorType: 'TCP_MLLP',
    properties: { ...TCP_MLLP_DEST_DEFAULTS },
    queueMode: 'NEVER',
    retryCount: 0,
    retryIntervalMs: 10000,
    rotateQueue: false,
    queueThreadCount: 1,
    waitForPrevious: false,
    filter: createDefaultFilter(),
    transformer: createDefaultTransformer(),
    responseTransformer: '',
    responseTransformerLanguage: NEW_SCRIPT_LANGUAGE,
  };
}
