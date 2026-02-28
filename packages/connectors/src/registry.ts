// ===========================================
// Connector Registry
// ===========================================
// Maps connector types to factory functions.

import type { SourceConnectorRuntime, DestinationConnectorRuntime } from './base.js';
import { TcpMllpReceiver } from './tcp-mllp/tcp-mllp-receiver.js';
import { TcpMllpDispatcher } from './tcp-mllp/tcp-mllp-dispatcher.js';
import { HttpReceiver } from './http/http-receiver.js';
import { HttpDispatcher } from './http/http-dispatcher.js';

// ----- Source Factories -----

type SourceFactory = (properties: Record<string, unknown>) => SourceConnectorRuntime;

const sourceFactories = new Map<string, SourceFactory>([
  ['TCP_MLLP', (props): SourceConnectorRuntime => new TcpMllpReceiver({
    host: (props['host'] as string | undefined) ?? '0.0.0.0',
    port: props['port'] as number,
    maxConnections: (props['maxConnections'] as number | undefined) ?? 10,
  })],
  ['HTTP', (props): SourceConnectorRuntime => new HttpReceiver({
    host: (props['host'] as string | undefined) ?? '0.0.0.0',
    port: props['port'] as number,
    path: (props['path'] as string | undefined) ?? '/',
    method: (props['method'] as string | undefined) ?? 'POST',
    responseContentType: (props['responseContentType'] as string | undefined) ?? 'text/plain',
    responseStatusCode: (props['responseStatusCode'] as number | undefined) ?? 200,
  })],
]);

// ----- Destination Factories -----

type DestinationFactory = (properties: Record<string, unknown>) => DestinationConnectorRuntime;

const destinationFactories = new Map<string, DestinationFactory>([
  ['TCP_MLLP', (props): DestinationConnectorRuntime => new TcpMllpDispatcher({
    host: props['host'] as string,
    port: props['port'] as number,
    maxConnections: (props['maxConnections'] as number | undefined) ?? 5,
    responseTimeout: (props['responseTimeout'] as number | undefined) ?? 30_000,
  })],
  ['HTTP', (props): DestinationConnectorRuntime => new HttpDispatcher({
    url: props['url'] as string,
    method: (props['method'] as string | undefined) ?? 'POST',
    headers: (props['headers'] as Record<string, string> | undefined) ?? {},
    contentType: (props['contentType'] as string | undefined) ?? 'text/plain',
    responseTimeout: (props['responseTimeout'] as number | undefined) ?? 30_000,
  })],
]);

// ----- Public API -----

/** Create a source connector by type. */
export function createSourceConnector(
  connectorType: string,
  properties: Record<string, unknown>,
): SourceConnectorRuntime {
  const factory = sourceFactories.get(connectorType);
  if (!factory) {
    throw new Error(`Unknown source connector type: ${connectorType}`);
  }
  return factory(properties);
}

/** Create a destination connector by type. */
export function createDestinationConnector(
  connectorType: string,
  properties: Record<string, unknown>,
): DestinationConnectorRuntime {
  const factory = destinationFactories.get(connectorType);
  if (!factory) {
    throw new Error(`Unknown destination connector type: ${connectorType}`);
  }
  return factory(properties);
}
