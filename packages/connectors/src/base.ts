import { fillPlaceholders, recordLookup, type Result } from '@galvanigraph/core-util';

export interface ConnectorLifecycle {
  onDeploy(): Promise<Result<void>>;
  onStart(): Promise<Result<void>>;
  /** Graceful stop. */
  onStop(): Promise<Result<void>>;
  /** Forced stop. */
  onHalt(): Promise<Result<void>>;
  onUndeploy(): Promise<Result<void>>;
}

export interface RawMessage {
  readonly content: string;
  readonly sourceMap: Readonly<Record<string, unknown>>;
}

/**
 * FILTERED was received and deliberately not routed, so a source still acknowledges it
 * (ACK AA, HTTP 200). ERROR answers NAK AE.
 */
export const DISPATCH_STATUS = {
  PROCESSED: 'PROCESSED',
  FILTERED: 'FILTERED',
  ERROR: 'ERROR',
} as const;
export type DispatchStatus = typeof DISPATCH_STATUS[keyof typeof DISPATCH_STATUS];

export interface DispatchResult {
  readonly messageId: number;
  readonly response?: string;
  /** Absent means PROCESSED. */
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

export type MessageDispatcher = (raw: RawMessage) => Promise<Result<DispatchResult>>;

/**
 * For a source that stopped itself on an error it cannot get past (a message the pipeline
 * never stores). The engine stops the channel and raises an event and an alert.
 */
export type SourceFatalHandler = (error: Error) => void;

export interface SourceConnectorRuntime extends ConnectorLifecycle {
  setDispatcher(dispatcher: MessageDispatcher): void;
  /** Only sources that can stop themselves have it. */
  setFatalHandler?(handler: SourceFatalHandler): void;
}

export interface ConnectorMessage {
  readonly channelId: string;
  readonly messageId: number;
  readonly metaDataId: number;
  readonly content: string;
  readonly dataType: string;
  readonly correlationId?: string | undefined;
  /** Script map values as this destination saw them (connector, channel, response maps; the first with a name wins). */
  readonly variables?: Readonly<Record<string, unknown>> | undefined;
}

/** By {@link fillPlaceholders}. A name the message lacks is left as written, so a mistake shows in what is sent. */
export function fillVariables(text: string, message: Pick<ConnectorMessage, 'variables'>): string {
  return message.variables ? fillPlaceholders(text, recordLookup(message.variables)) : text;
}

export interface ConnectorResponse {
  readonly status: 'SENT' | 'ERROR';
  readonly content: string;
  readonly errorMessage?: string;
}

export interface DestinationConnectorRuntime extends ConnectorLifecycle {
  send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>>;
}
