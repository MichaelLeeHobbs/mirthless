// ===========================================
// Connector Default Properties
// ===========================================
// Default property objects for each source connector type.

// Keys must match what packages/connectors/src/registry.ts reads for each type.
// The TcpMllpReceiver consumes host/port/maxConnections/responseMode/charset/
// maxFrameBytes (TLS is resolved server-side and not surfaced here yet — see the
// form comment). charset must be a valid Node BufferEncoding token: the registry
// casts it straight to BufferEncoding with no normalization.
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
  // Transport mode. HTTPS makes the listener terminate TLS using a server
  // certificate selected from the certificate store by ID; the server resolves
  // IDs -> PEM at deploy time (readTlsServerOptions consumes the resolved
  // cert/key/ca/requireClientCert bag). No raw PEM is stored here.
  scheme: 'HTTP',
  tls: { serverCertId: '', caCertId: '', requireClientCert: false },
};

export const FILE_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  directory: '',
  fileFilter: '*',
  pollingIntervalMs: 5000,
  sortBy: 'NAME',
  charset: 'UTF-8',
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
  selectQuery: '',
  updateQuery: '',
  updateMode: 'NEVER',
  pollingIntervalMs: 5000,
  rowFormat: 'JSON',
};

export const JAVASCRIPT_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  script: '',
  pollingIntervalMs: 5000,
};

export const CHANNEL_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  channelId: '',
};

export const DICOM_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  port: 4242,
  storageDir: '',
  aeTitle: 'MIRTHLESS',
  minPoolSize: 2,
  maxPoolSize: 10,
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

// Keys MUST match exactly what the SFTP source connector reads in
// packages/connectors/src/sftp (host/port/username/password/privateKey/
// passphrase/remoteDirectory/filePattern/pollingIntervalMs/afterProcessing/
// moveToDirectory/minFileAgeMs/strictHostKey/hostKey).
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
  strictHostKey: true,
  hostKey: '',
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
};

/** Get default properties for a connector type. Returns empty object for unknown types. */
export function getDefaultProperties(connectorType: string): Record<string, unknown> {
  return { ...(DEFAULTS_MAP[connectorType] ?? {}) };
}
