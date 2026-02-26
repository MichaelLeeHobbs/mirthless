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

const DEFAULTS_MAP: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  TCP_MLLP: TCP_MLLP_SOURCE_DEFAULTS,
  HTTP: HTTP_SOURCE_DEFAULTS,
};

/** Get default properties for a connector type. Returns empty object for unknown types. */
export function getDefaultProperties(connectorType: string): Record<string, unknown> {
  return { ...(DEFAULTS_MAP[connectorType] ?? {}) };
}
