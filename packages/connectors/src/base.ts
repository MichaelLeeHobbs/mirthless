import { fillPlaceholders, placeholderNames, recordLookup, type Result } from '@galvanigraph/core-util';

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
  /**
   * Called once the message is in the store and before any script or destination runs: a source
   * that only answers "received" need not wait for them. `recoverable` is false when the channel
   * does not store raw content, so a restart finds the message and cannot run it again. Not every
   * dispatcher calls it. Must not throw.
   */
  readonly onStored?: ((stored: { readonly recoverable: boolean }) => void) | undefined;
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
  /**
   * True when a queued destination has not delivered the message yet. A source
   * that would remove what it read (a file it deletes or moves) must keep it
   * until `onMessageDelivered` says every destination has delivered.
   */
  readonly queued?: boolean | undefined;
  /**
   * True when a destination or the postprocessor failed although `status` is
   * PROCESSED: the channel answers the sender before its destinations
   * (AUTO_BEFORE, AUTO_AFTER_TRANSFORMER). A source must still keep what it
   * read, so the message can be reprocessed.
   */
  readonly destinationFailed?: boolean | undefined;
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

/**
 * Told of each poll, and of a connection to a partner when it is made, when it is lost (null, then why)
 * and when it cannot be made, while the source runs: why it failed, or null when it worked. The engine
 * decides which failures are due an alert.
 */
export type SourceHealthHandler = (failure: Error | null) => void;

export interface SourceConnectorRuntime extends ConnectorLifecycle {
  setDispatcher(dispatcher: MessageDispatcher): void;
  /** Only sources that poll, or that connect to their partner, have it. */
  setHealthHandler?(handler: SourceHealthHandler): void;
  /** Only sources that can stop themselves have it. */
  setFatalHandler?(handler: SourceFatalHandler): void;
  /**
   * A message this source dispatched with `queued` set has now been delivered
   * by every destination, without an error. `content` is the raw content the
   * source dispatched. Called by the queue consumer, so it can come after a
   * restart, from a new instance of the source.
   */
  onMessageDelivered?(content: string, messageId: number): Promise<void>;
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

/** The names {@link fillVariables} looks up in these texts. */
export function variableNames(texts: readonly string[]): readonly string[] {
  return [...new Set(texts.flatMap(placeholderNames))].filter((name) => name !== '');
}

export interface ConnectorResponse {
  readonly status: 'SENT' | 'ERROR';
  readonly content: string;
  readonly errorMessage?: string;
  /**
   * On an ERROR: sending it again would do harm or cannot help. The partner kept the message although it
   * failed there, so it would get a second copy (D-393), or the message can never be sent as it is (D-397).
   * The send ends ERROR and is not queued for a retry.
   */
  readonly final?: true;
}

export interface DestinationConnectorRuntime extends ConnectorLifecycle {
  send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>>;
  /**
   * The names in `message.variables` that sending this message looks up. Crash recovery
   * does not send a message whose variables were not kept to a destination that names any.
   */
  variablesUsed(message: ConnectorMessage): readonly string[];
}
