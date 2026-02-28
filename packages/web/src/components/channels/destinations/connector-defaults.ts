// ===========================================
// Destination Connector Default Properties
// ===========================================

import type { DestinationFormValues } from './types.js';

export const TCP_MLLP_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: 'localhost',
  port: 6661,
  sendTimeout: 10000,
  keepConnectionOpen: true,
  charset: 'UTF-8',
  transmissionMode: 'MLLP',
  bufferSize: 65536,
};

export const HTTP_DEST_DEFAULTS: Readonly<Record<string, unknown>> = {
  url: 'http://localhost:8080',
  method: 'POST',
  headers: '',
  contentType: 'text/plain',
  charset: 'UTF-8',
  responseTimeout: 30000,
};

const DEFAULTS_MAP: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  TCP_MLLP: TCP_MLLP_DEST_DEFAULTS,
  HTTP: HTTP_DEST_DEFAULTS,
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
  };
}
