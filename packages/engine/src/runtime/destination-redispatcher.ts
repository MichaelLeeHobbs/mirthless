import { tryCatch, type Result } from '@galvanigraph/core-util';
import { CONTENT_TYPE, type ContentType } from '@galvanigraph/core-models';
import type {
  AlertEventHandler,
  DestinationConfig,
  DestinationResponse,
  MessageStore,
  SendToDestination,
  StoreFailure,
  VariablesUsed,
} from '../pipeline/message-processor.js';
import { reportUnsaved } from '../pipeline/report-unsaved.js';
import { sendFailureReason } from '../pipeline/send-failure.js';
import { parseStoredVariables } from '../pipeline/stored-variables.js';
import type { ConnectorMessageRecord } from './recovery-manager.js';

const NOTHING_TO_SEND = 'nothing is stored to send. The server stopped before this destination ran, '
  + "or the channel's storage mode does not keep what is sent and it may have been delivered. Reprocess the message to deliver it.";

const MAY_BE_DELIVERED = 'It may have been delivered: check before you reprocess the message.';

function variablesNotKept(names: readonly string[]): string {
  return `this destination uses the message's variables (${names.join(', ')}), and they are kept only for a destination that queues. ${MAY_BE_DELIVERED}`;
}

/** How it ended, as recorded. A QUEUED one is the queue consumer's from then on. */
export type RedispatchOutcome = 'SENT' | 'QUEUED' | 'ERROR';

export interface RedispatchConfig {
  readonly channelId: string;
  readonly serverId: string;
  readonly store: MessageStore;
  readonly send: SendToDestination;
  /** As deployed now. */
  readonly destinations: readonly DestinationConfig[];
  /** Whether a message stored for a number is for the destination that has it now; false when that is not known. */
  readonly isForItsNumber: (messageId: number, metaDataId: number) => Promise<Result<boolean>>;
  readonly variablesUsed: VariablesUsed;
  /** Nothing is sent or queued once it is aborted. */
  readonly runSignal: AbortSignal;
  readonly haltSignal: AbortSignal;
  readonly onError: AlertEventHandler;
  /** For the log. The reason is null when it came from the partner. */
  readonly onFailed: (messageId: number, metaDataId: number, reason: string | null) => void;
  readonly onStoreFailure: (failure: StoreFailure) => void;
}

/** For crash recovery: sends what the pipeline had stored for a destination, and records it as the pipeline does. */
export class DestinationRedispatcher {
  private readonly config: RedispatchConfig;

  constructor(config: RedispatchConfig) {
    this.config = config;
  }

  /** Not ok when the destination was left as it was, for a later recovery. */
  async redispatch({ messageId, metaDataId }: ConnectorMessageRecord): Promise<Result<RedispatchOutcome>> {
    return tryCatch(async () => {
      const destination = await this.destinationFor(messageId, metaDataId);
      if (typeof destination === 'string') return this.refuse(messageId, metaDataId, destination);

      const content = await this.load(messageId, metaDataId, CONTENT_TYPE.SENT);
      if (content === null) return this.refuse(messageId, metaDataId, NOTHING_TO_SEND);

      const variables = parseStoredVariables(await this.load(messageId, metaDataId, CONTENT_TYPE.CHANNEL_MAP));
      if (variables === 'INVALID') return this.refuse(messageId, metaDataId, 'the variables stored for it are not a JSON object');
      // Whatever its queue mode: it may have been changed since the message was routed.
      const missing = variables ? [] : this.config.variablesUsed(metaDataId, messageId, content);
      if (missing.length > 0) return this.refuse(messageId, metaDataId, variablesNotKept(missing));

      return this.deliver(messageId, destination, content, variables);
    });
  }

  /** Or why there is none to send to. */
  private async destinationFor(messageId: number, metaDataId: number): Promise<DestinationConfig | string> {
    const now = this.config.destinations.find((d) => d.metaDataId === metaDataId);
    if (!now) return `the channel no longer has the destination it was prepared for. ${MAY_BE_DELIVERED}`;
    if (!now.enabled) return `this destination is switched off. ${MAY_BE_DELIVERED}`;
    const its = await this.config.isForItsNumber(messageId, metaDataId);
    if (!its.ok) throw its.error;
    return its.value ? now : `it is from before destinations kept their numbers, and it is not known to be for this one. ${MAY_BE_DELIVERED}`;
  }

  private async deliver(
    messageId: number,
    { metaDataId, queueMode }: DestinationConfig,
    content: string,
    variables: Readonly<Record<string, unknown>> | undefined,
  ): Promise<RedispatchOutcome> {
    const { runSignal, haltSignal } = this.config;
    if (runSignal.aborted) throw new Error('Interrupted: the channel stopped');
    if (queueMode === 'ALWAYS') return this.enqueue(messageId, metaDataId);

    const sent = await this.config.send(metaDataId, messageId, content, haltSignal, undefined, variables);
    if (sent.ok && sent.value.status === 'SENT') return this.recordSent(messageId, metaDataId, sent.value.content);
    // An answer, even a refusal, came by itself.
    if (!sent.ok && haltSignal.aborted) throw new Error('Interrupted: the channel was halted');

    await this.storeResponse(messageId, metaDataId, sent);
    if (queueMode !== 'ON_FAILURE' || (sent.ok && sent.value.final === true)) return this.fail(messageId, metaDataId, CONTENT_TYPE.ERROR, sendFailureReason(sent));
    await this.storeReason(messageId, metaDataId, CONTENT_TYPE.ERROR, sendFailureReason(sent));
    return this.enqueue(messageId, metaDataId);
  }

  private async load(messageId: number, metaDataId: number, contentType: ContentType): Promise<string | null> {
    const loaded = await this.config.store.loadContent(this.config.channelId, messageId, metaDataId, contentType);
    if (!loaded.ok) throw loaded.error;
    return loaded.value;
  }

  private async enqueue(messageId: number, metaDataId: number): Promise<RedispatchOutcome> {
    const queued = await this.config.store.enqueue(this.config.channelId, messageId, metaDataId);
    if (!queued.ok) throw queued.error;
    return 'QUEUED';
  }

  /** It cannot be taken back, so a write that fails is reported and the message is not sent again. */
  private async recordSent(messageId: number, metaDataId: number, response: string): Promise<RedispatchOutcome> {
    const { channelId, serverId, store } = this.config;
    await Promise.all([
      this.saved(messageId, metaDataId, 'the SENT status of a delivered destination', [
        store.updateConnectorMessageStatus(channelId, messageId, metaDataId, 'SENT'),
        store.incrementStats(channelId, metaDataId, serverId, 'sent'),
      ]),
      this.saved(messageId, metaDataId, 'the response of a delivered destination', [
        store.storeContent(channelId, messageId, metaDataId, CONTENT_TYPE.RESPONSE, response, 'TEXT'),
      ]),
      // The attempt that the server stop interrupted may have left why it failed.
      ...(store.removeContent ? [this.saved(messageId, metaDataId, 'the removal of why an earlier attempt failed', [
        store.removeContent(channelId, messageId, metaDataId, CONTENT_TYPE.ERROR),
      ])] : []),
    ]);
    return 'SENT';
  }

  private refuse(messageId: number, metaDataId: number, why: string): Promise<RedispatchOutcome> {
    return this.fail(messageId, metaDataId, CONTENT_TYPE.PROCESSING_ERROR, `Not sent after a server stop: ${why}`);
  }

  private async fail(messageId: number, metaDataId: number, contentType: ContentType, reason: string): Promise<RedispatchOutcome> {
    const { channelId, serverId, store } = this.config;
    await this.storeReason(messageId, metaDataId, contentType, reason);
    const failed = await store.updateConnectorMessageStatus(channelId, messageId, metaDataId, 'ERROR');
    if (!failed.ok) throw failed.error;
    this.config.onFailed(messageId, metaDataId, contentType === CONTENT_TYPE.ERROR ? null : reason);
    await this.saved(messageId, metaDataId, 'the count of a failed destination', [store.incrementStats(channelId, metaDataId, serverId, 'errored')]);
    await this.config.onError({
      channelId,
      errorType: 'DESTINATION_CONNECTOR',
      errorMessage: `Crash recovery could not deliver message ${String(messageId)} to destination ${String(metaDataId)}: ${reason}`,
      timestamp: Date.now(),
    });
    return 'ERROR';
  }

  private async storeReason(messageId: number, metaDataId: number, contentType: ContentType, reason: string): Promise<void> {
    await this.saved(messageId, metaDataId, 'why a destination failed', [
      this.config.store.storeContent(this.config.channelId, messageId, metaDataId, contentType, reason, 'TEXT'),
    ]);
  }

  private async storeResponse(messageId: number, metaDataId: number, sent: Result<DestinationResponse>): Promise<void> {
    if (!sent.ok || sent.value.content === '') return;
    await this.saved(messageId, metaDataId, 'the response of a failed destination', [
      this.config.store.storeContent(this.config.channelId, messageId, metaDataId, CONTENT_TYPE.RESPONSE, sent.value.content, 'TEXT'),
    ]);
  }

  private saved(messageId: number, metaDataId: number, what: string, writes: ReadonlyArray<Promise<Result<unknown>>>): Promise<void> {
    return reportUnsaved(writes, { channelId: this.config.channelId, messageId, metaDataId, what }, this.config.onStoreFailure);
  }
}
