// ===========================================
// Connector Default Properties
// ===========================================
// Default property objects for each source connector type.

export const TCP_MLLP_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: '0.0.0.0',
  port: 6661,
  maxConnections: 10,
  receiveTimeout: 0,
  bufferSize: 65536,
  keepConnectionOpen: true,
  charset: 'UTF-8',
  transmissionMode: 'MLLP',
};

export const HTTP_SOURCE_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: '0.0.0.0',
  port: 8080,
  contextPath: '/',
  methods: ['POST'],
  responseStatusCode: 200,
  responseContentType: 'text/plain',
  charset: 'UTF-8',
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

const DEFAULTS_MAP: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  TCP_MLLP: TCP_MLLP_SOURCE_DEFAULTS,
  HTTP: HTTP_SOURCE_DEFAULTS,
  FILE: FILE_SOURCE_DEFAULTS,
  DATABASE: DATABASE_SOURCE_DEFAULTS,
  JAVASCRIPT: JAVASCRIPT_SOURCE_DEFAULTS,
  CHANNEL: CHANNEL_SOURCE_DEFAULTS,
  DICOM: DICOM_SOURCE_DEFAULTS,
};

/** Get default properties for a connector type. Returns empty object for unknown types. */
export function getDefaultProperties(connectorType: string): Record<string, unknown> {
  return { ...(DEFAULTS_MAP[connectorType] ?? {}) };
}
