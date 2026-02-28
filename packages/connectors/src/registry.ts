// ===========================================
// Connector Registry
// ===========================================
// Maps connector types to factory functions.

import type { SourceConnectorRuntime, DestinationConnectorRuntime } from './base.js';
import { TcpMllpReceiver } from './tcp-mllp/tcp-mllp-receiver.js';
import { TcpMllpDispatcher } from './tcp-mllp/tcp-mllp-dispatcher.js';

// ----- Source Factories -----

type SourceFactory = (properties: Record<string, unknown>) => SourceConnectorRuntime;

const sourceFactories: ReadonlyMap<string, SourceFactory> = new Map([
  ['TCP_MLLP', (props) => new TcpMllpReceiver({
    host: (props['host'] as string | undefined) ?? '0.0.0.0',
    port: props['port'] as number,
    maxConnections: (props['maxConnections'] as number | undefined) ?? 10,
  })],
]);

// ----- Destination Factories -----

type DestinationFactory = (properties: Record<string, unknown>) => DestinationConnectorRuntime;

const destinationFactories: ReadonlyMap<string, DestinationFactory> = new Map([
  ['TCP_MLLP', (props) => new TcpMllpDispatcher({
    host: props['host'] as string,
    port: props['port'] as number,
    maxConnections: (props['maxConnections'] as number | undefined) ?? 5,
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
