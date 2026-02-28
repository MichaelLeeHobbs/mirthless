// ===========================================
// Base Connector Interfaces
// ===========================================
// All connectors implement ConnectorLifecycle.
// Source connectors additionally dispatch messages into the pipeline.
// Destination connectors send messages to external systems.

import type { Result } from '@mirthless/core-util';

// ----- Lifecycle -----

/** Lifecycle hooks for connector instances. */
export interface ConnectorLifecycle {
  /** Called when the channel is deployed. */
  onDeploy(): Promise<Result<void>>;
  /** Called when the channel starts. */
  onStart(): Promise<Result<void>>;
  /** Called when the channel stops gracefully. */
  onStop(): Promise<Result<void>>;
  /** Called when the channel force-stops. */
  onHalt(): Promise<Result<void>>;
  /** Called when the channel is undeployed. */
  onUndeploy(): Promise<Result<void>>;
}

// ----- Raw Message -----

/** An inbound message from a source connector. */
export interface RawMessage {
  readonly content: string;
  readonly sourceMap: Readonly<Record<string, unknown>>;
}

// ----- Source Connector -----

/** Result of dispatching a message through the pipeline. */
export interface DispatchResult {
  readonly messageId: number;
  readonly response?: string;
}

/** Callback provided by the engine to process incoming messages. */
export type MessageDispatcher = (raw: RawMessage) => Promise<Result<DispatchResult>>;

/** Source connector that receives messages and dispatches them into the pipeline. */
export interface SourceConnectorRuntime extends ConnectorLifecycle {
  /** Set the callback used to dispatch messages to the engine. */
  setDispatcher(dispatcher: MessageDispatcher): void;
}

// ----- Destination Connector -----

/** A message being sent to a destination. */
export interface ConnectorMessage {
  readonly channelId: string;
  readonly messageId: number;
  readonly metaDataId: number;
  readonly content: string;
  readonly dataType: string;
}

/** Response from a destination connector after sending. */
export interface ConnectorResponse {
  readonly status: 'SENT' | 'ERROR';
  readonly content: string;
  readonly errorMessage?: string;
}

/** Destination connector that sends messages to external systems. */
export interface DestinationConnectorRuntime extends ConnectorLifecycle {
  /** Send a message and return the response. */
  send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>>;
}
