// ===========================================
// Base Connector Interfaces
// ===========================================
// All connectors implement ConnectorLifecycle.
// Source connectors additionally dispatch messages into the pipeline.
// Destination connectors send messages to external systems.

import type { Result } from '@galvaniflow/core-util';

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

/**
 * Outcome of a message through the pipeline, used by source connectors
 * to decide how to acknowledge (e.g. MLLP ACK vs NAK).
 * - PROCESSED: filter passed and destinations completed.
 * - FILTERED: rejected by a filter (application reject → NAK AR).
 * - ERROR: a processing error occurred (→ NAK AE).
 */
export const DISPATCH_STATUS = {
  PROCESSED: 'PROCESSED',
  FILTERED: 'FILTERED',
  ERROR: 'ERROR',
} as const;
export type DispatchStatus = typeof DISPATCH_STATUS[keyof typeof DISPATCH_STATUS];

/** Result of dispatching a message through the pipeline. */
export interface DispatchResult {
  readonly messageId: number;
  readonly response?: string;
  /**
   * Pipeline outcome. Absent implies PROCESSED (backward compatible with
   * callers that do not yet report status).
   */
  readonly status?: DispatchStatus | undefined;
}

/**
 * Why a source must not treat a dispatched message as handled, or null when the
 * pipeline accepted it (processed or filtered).
 *
 * Two different failures share this answer, and `result.ok` tells them apart:
 * - `!result.ok`: the pipeline could not take the message at all. Nothing was
 *   recorded, so the source must keep it and offer it again.
 * - `result.ok` with status ERROR: the message was recorded with an error. The
 *   source must still not report success (no 200, no ACK AA, no delete), but
 *   offering it again would process it twice.
 */
export function dispatchFailure(result: Result<DispatchResult>): Error | null {
  if (!result.ok) return result.error;
  if (result.value.status === DISPATCH_STATUS.ERROR) {
    return new Error(`Message ${String(result.value.messageId)} was recorded with an ERROR status`);
  }
  return null;
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
  /** Correlation ID for cross-channel tracing. */
  readonly correlationId?: string | undefined;
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
