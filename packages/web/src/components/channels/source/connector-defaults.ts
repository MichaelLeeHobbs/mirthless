import { KAFKA_CONNECTION_DEFAULTS, AMQP_CONNECTION_DEFAULTS } from '../common/queue-connection-defaults.js';
import { NEW_SCRIPT_LANGUAGE } from '../../../lib/script-language.js';

// Keys must match what packages/connectors/src/registry.ts reads for each type.
// TCP_MLLP, KAFKA and AMQP defaults must equal their core-models schema
// defaults (connector-defaults.test.ts and QueueConnectorForms.test.tsx check).
export const TCP_MLLP_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: '0.0.0.0',
  port: 6661,
  maxConnections: 10,
  responseMode: 'AUTO_ACK',
  charset: 'utf-8',
  maxFrameBytes: 52428800,
};

export const HTTP_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: '0.0.0.0',
  port: 8080,
  path: '/',
  method: 'POST',
  responseStatusCode: 200,
  responseContentType: 'text/plain',
  errorStatusCode: 500,
  maxBodyBytes: 52428800,
  bodyCharset: 'utf-8',
  // HTTPS takes certificate-store IDs, which the server resolves to PEM at deploy. Never store raw PEM here.
  scheme: 'HTTP',
  tls: { serverCertId: '', caCertId: '', requireClientCert: false },
};

export const FILE_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  directory: '',
  fileFilter: '*',
  ignoreDot: true,
  pollingIntervalMs: 5000,
  sortBy: 'NAME',
  charset: 'utf-8',
  binary: false,
  checkFileAge: true,
  fileAgeMs: 1000,
  postAction: 'DELETE',
  moveToDirectory: '',
};

export const DATABASE_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: 'localhost',
  port: 5432,
  database: '',
  username: '',
  password: '',
  tls: false,
  selectQuery: '',
  updateQuery: '',
  updateMode: 'NEVER',
  pollingIntervalMs: 5000,
  rowFormat: 'JSON',
};

export const JAVASCRIPT_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  script: '',
  scriptLanguage: NEW_SCRIPT_LANGUAGE,
  pollingIntervalMs: 5000,
};

export const CHANNEL_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  channelId: '',
};

export const DICOM_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  port: 4242,
  storageDir: '',
  aeTitle: 'GALVANIGRAPH',
  connectionTimeoutMs: 10000,
  dispatchMode: 'PER_FILE',
  postAction: 'DELETE',
  moveToDirectory: '',
};

export const EMAIL_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: '',
  port: 993,
  secure: true,
  username: '',
  password: '',
  protocol: 'IMAP',
  folder: 'INBOX',
  pollingIntervalMs: 60000,
  postAction: 'MARK_READ',
  moveToFolder: '',
  subjectFilter: '',
  includeAttachments: false,
};

export const SFTP_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: '',
  port: 22,
  username: '',
  password: '',
  privateKey: '',
  passphrase: '',
  remoteDirectory: '',
  filePattern: '*',
  pollingIntervalMs: 5000,
  afterProcessing: 'DELETE',
  moveToDirectory: '',
  minFileAgeMs: 1000,
  ignoreDot: true,
  charset: 'utf-8',
  strictHostKey: true,
  hostKey: '',
};

export const KAFKA_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  ...KAFKA_CONNECTION_DEFAULTS,
  topic: '',
  groupId: '',
  startFrom: 'EARLIEST',
  charset: 'utf-8',
  maxStoreAttempts: 5,
};

export const AMQP_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  ...AMQP_CONNECTION_DEFAULTS,
  queue: '',
  charset: 'utf-8',
  maxStoreAttempts: 5,
};

const DEFAULTS_MAP: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  TCP_MLLP: TCP_MLLP_SOURCE_DEFAULTS,
  HTTP: HTTP_SOURCE_DEFAULTS,
  FILE: FILE_SOURCE_DEFAULTS,
  DATABASE: DATABASE_SOURCE_DEFAULTS,
  JAVASCRIPT: JAVASCRIPT_SOURCE_DEFAULTS,
  CHANNEL: CHANNEL_SOURCE_DEFAULTS,
  DICOM: DICOM_SOURCE_DEFAULTS,
  EMAIL: EMAIL_SOURCE_DEFAULTS,
  SFTP: SFTP_SOURCE_DEFAULTS,
  KAFKA: KAFKA_SOURCE_DEFAULTS,
  AMQP: AMQP_SOURCE_DEFAULTS,
};

export function getDefaultProperties(connectorType: string): Record<string, unknown> {
  return { ...(DEFAULTS_MAP[connectorType] ?? {}) };
}
