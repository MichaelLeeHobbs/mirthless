// ===========================================
// Destination Connector Default Properties
// ===========================================

import type { DestinationFormValues } from './types.js';
import { createDefaultFilter, createDefaultTransformer } from '../source/types.js';

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
  // Transport mode. HTTPS selects TLS material from the certificate store by ID;
  // the server resolves IDs -> PEM at deploy time (readTlsClientOptions consumes
  // the resolved cert/key/ca/rejectUnauthorized bag). No raw PEM is stored here.
  scheme: 'HTTP',
  tls: { caCertId: '', clientCertId: '', rejectUnauthorized: true },
};

export const FILE_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  directory: '',
  outputPattern: '${messageId}.txt',
  charset: 'UTF-8',
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
  query: '',
  useTransaction: false,
  returnGeneratedKeys: false,
};

export const JAVASCRIPT_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  script: '',
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
  callingAETitle: 'MIRTHLESS',
  mode: 'multiple',
  maxAssociations: 4,
  maxRetries: 3,
  retryDelayMs: 1000,
  timeoutMs: 30000,
};

// Keys MUST match exactly what the SFTP destination connector reads in
// packages/connectors/src/sftp (host/port/username/password/privateKey/
// passphrase/remoteDirectory/fileNameTemplate/appendMode/strictHostKey/hostKey).
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
};

/** Get default properties for a destination connector type. */
export function getDestDefaultProperties(connectorType: string): Record<string, unknown> {
  return { ...(DEFAULTS_MAP[connectorType] ?? {}) };
}

/** Create a new destination with defaults. */
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
  };
}
