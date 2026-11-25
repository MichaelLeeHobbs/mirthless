import type { Result } from '@galvanigraph/core-util';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import type { MessageStore, DestinationResponse, SendToDestination, AlertEventHandler, StoreFailure } from '../pipeline/message-processor.js';
import { reportUnsaved } from '../pipeline/report-unsaved.js';
import { sendFailureReason } from '../pipeline/send-failure.js';
import { parseStoredVariables } from '../pipeline/stored-variables.js';

export interface QueueConsumerConfig {
  readonly channelId: string;
  readonly metaDataId: number;
  readonly serverId: string;
  /**
   * Retries after the first failed attempt before the message is given up on
   * (ERROR). 0 means never give up: a queued message is retried until it is
   * delivered, so an outage of any length loses nothing.
   */
  readonly retryCount: number;
  readonly retryIntervalMs: number;
  /**
   * When true a failed message does not hold the queue: the messages behind it
   * are still attempted and the failed one goes to the back. Delivery order is
   * no longer guaranteed. When false (default) the queue waits behind a failure.
   */
  readonly rotate?: boolean | undefined;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  /** Raised when a queued message is given up on (final ERROR), same as pipeline destination errors. */
  readonly onError?: AlertEventHandler | undefined;
  /** For the log: a store write for one message that failed, whether or not it raises an alert too. */
  readonly onStoreFailure?: ((failure: StoreFailure) => void) | undefined;
  /**
   * Called once a delivery leaves the whole message delivered (every connector
   * SENT or FILTERED, per `MessageStore.isFullyDelivered`), with the raw
   * content the source dispatched. A source that keeps what it read until then
   * (a DICOM file it deletes or moves) acts on it here.
   */
  readonly onMessageDelivered?: ((messageId: number, rawContent: string) => Promise<void>) | undefined;
}

interface QueuedMessage {
  readonly channelId: string;
  readonly messageId: number;
  readonly metaDataId: number;
  readonly sendAttempts: number;
}

/** RETRY_LATER: it failed and is back on the queue. HALTED: a halt ended its send, and it is back on the queue. */
type Outcome = 'DONE' | 'RETRY_LATER' | 'HALTED';

const STATUS_OF = {
  SENT: 'the SENT status of a delivered destination',
  ERROR: 'the ERROR status of a failed destination',
  QUEUED: 'the QUEUED status of a destination',
} as const;

export class QueueConsumer {
  private readonly config: QueueConsumerConfig;
  private readonly store: MessageStore;
  private readonly sendFn: SendToDestination;
  private running = false;
  private stopRequested = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private haltController = new AbortController();
  private retryNotBefore = 0;
  private queueReadFailing = false;
  private failureAlerted = false;

  constructor(
    config: QueueConsumerConfig,
    store: MessageStore,
    sendFn: SendToDestination,
  ) {
    this.config = config;
    this.store = store;
    this.sendFn = sendFn;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    this.haltController = new AbortController();
    this.schedulePoll();
  }

  /**
   * Stop polling and wait for the send in flight to finish. Messages already
   * claimed but not yet sent go back on the queue without counting an attempt.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.stopRequested = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) await this.inFlight;
  }

  /** A stop that ends the send in flight instead of waiting for it. Its message goes back on the queue too. */
  async halt(): Promise<void> {
    const stopped = this.stop();
    this.haltController.abort();
    await stopped;
  }

  /**
   * Exposed for testing. After a failed send the messages behind it are held and
   * nothing is attempted until retryIntervalMs has passed, so an outage neither
   * reorders the queue nor burns through every message's retries in seconds.
   * With `rotate`, the wait applies only when every message in the batch failed.
   */
  async poll(): Promise<void> {
    if (Date.now() < this.retryNotBefore) return;

    const rotate = this.config.rotate === true;
    const dequeueResult = await this.store.dequeue(
      this.config.channelId,
      this.config.metaDataId,
      this.config.batchSize,
      rotate,
    );

    if (!dequeueResult.ok) {
      // Alert on the first failure of a streak, not on every poll.
      if (!this.queueReadFailing) {
        this.queueReadFailing = true;
        await this.alert(`Queued destination ${String(this.config.metaDataId)} could not read its queue: ${dequeueResult.error.message}`);
      }
      return;
    }
    this.queueReadFailing = false;

    const messages = [...(dequeueResult.value as readonly QueuedMessage[])]
      .sort((a, b) => Number(a.messageId) - Number(b.messageId));
    let failed = 0;
    for (let i = 0; i < messages.length; i++) {
      if (this.stopRequested) {
        await this.putBack(messages.slice(i));
        return;
      }
      const outcome = await this.processQueuedMessage(messages[i]!);
      if (outcome !== 'RETRY_LATER') continue;
      failed += 1;
      if (rotate) continue;
      this.retryNotBefore = Date.now() + this.config.retryIntervalMs;
      await this.putBack(messages.slice(i + 1));
      return;
    }
    if (failed > 0 && failed === messages.length) {
      this.retryNotBefore = Date.now() + this.config.retryIntervalMs;
    }
  }

  /** Without counting an attempt: none was made, or a halt ended it. */
  private async putBack(messages: readonly QueuedMessage[]): Promise<void> {
    for (const msg of messages) {
      const released = await this.saved(msg, STATUS_OF.QUEUED, this.store.release(this.config.channelId, msg.messageId, msg.metaDataId, 'QUEUED'));
      if (!released.ok) await this.reportUnrecorded(msg, 'QUEUED', released.error.message);
    }
  }

  private schedulePoll(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.pollSafely().finally(() => {
        this.inFlight = null;
        this.schedulePoll();
      });
    }, this.config.pollIntervalMs);
  }

  /** A poll that throws must not end the polling loop or go unreported. */
  private async pollSafely(): Promise<void> {
    try {
      await this.poll();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.alert(`Queued destination ${String(this.config.metaDataId)} poll failed: ${message}`).catch(() => undefined);
    }
  }

  private async processQueuedMessage(msg: QueuedMessage): Promise<Outcome> {
    const halted = this.haltController.signal;
    const signal = AbortSignal.any([halted, AbortSignal.timeout(30_000)]);

    const contentResult = await this.store.loadContent(
      msg.channelId, msg.messageId, msg.metaDataId, CONTENT_TYPE.SENT,
    );

    if (!contentResult.ok) {
      // The store could not be read just now. That says nothing about the
      // message: put it back untouched and try again after the retry interval.
      await this.putBack([msg]);
      await this.alertOnce(
        `Queued destination ${String(msg.metaDataId)} could not load message ${String(msg.messageId)} ` +
        `to deliver it: ${contentResult.error.message}. It stays queued and is retried.`,
      );
      return 'RETRY_LATER';
    }
    if (contentResult.value === null) {
      await this.giveUp(msg, 'Queued message has no stored SENT content to deliver');
      return 'DONE';
    }

    // The variables the destination saw when the message was routed (a
    // database writer binds its parameters from them). Absent when there were none.
    const variablesResult = await this.store.loadContent(msg.channelId, msg.messageId, msg.metaDataId, CONTENT_TYPE.CHANNEL_MAP);
    if (!variablesResult.ok) {
      await this.putBack([msg]);
      await this.alertOnce(
        `Queued destination ${String(msg.metaDataId)} could not load the variables of message ${String(msg.messageId)}: ` +
        `${variablesResult.error.message}. It stays queued and is retried.`,
      );
      return 'RETRY_LATER';
    }
    const variables = parseStoredVariables(variablesResult.value);
    if (variables === 'INVALID') {
      await this.giveUp(msg, 'Queued message has stored variables that are not a JSON object');
      return 'DONE';
    }

    const sendResult: Result<DestinationResponse> = await this.sendFn(
      msg.metaDataId, msg.messageId, contentResult.value, signal, undefined, variables,
    );

    if (sendResult.ok && sendResult.value.status === 'SENT') {
      this.failureAlerted = false;
      await this.finishSent(msg, sendResult.value.content);
      return 'DONE';
    }
    // An answer, even a refusal, came by itself.
    if (!sendResult.ok && halted.aborted) {
      await this.putBack([msg]);
      return 'HALTED';
    }

    const attempts = (msg.sendAttempts ?? 0) + 1;
    const reason = sendFailureReason(sendResult);
    const retriesUsed = attempts - 1;
    if (this.config.retryCount > 0 && retriesUsed >= this.config.retryCount) {
      await this.giveUp(msg, `Delivery failed after ${String(attempts)} attempt(s): ${reason}`);
      return 'DONE';
    }

    // Nobody would otherwise hear about a destination that is down until the
    // retries run out, which with retryCount 0 is never.
    await this.alertOnce(
      `Queued destination ${String(msg.metaDataId)} could not deliver message ${String(msg.messageId)}: ` +
      `${reason}. It stays queued and is retried every ${String(Math.round(this.config.retryIntervalMs / 1000))} s.`,
    );

    // Keep the latest reason with the message, so the message browser says why
    // it is still queued.
    await this.storeReason(msg, reason);

    // Re-queue for retry. Transitioning back to QUEUED persists an incremented
    // send_attempts (see MessageService.updateConnectorMessageStatus), which the
    // retry cap above counts.
    const requeued = await this.saved(msg, STATUS_OF.QUEUED, this.store.updateConnectorMessageStatus(
      this.config.channelId, msg.messageId, msg.metaDataId, 'QUEUED',
    ));
    if (!requeued.ok) await this.reportUnrecorded(msg, 'QUEUED', requeued.error.message);
    return 'RETRY_LATER';
  }

  private async finishSent(msg: QueuedMessage, response: string): Promise<void> {
    const { channelId, serverId } = this.config;
    // Keep the destination's response, as the direct-send path does, so the
    // message browser shows it for queued deliveries too.
    const stored = await this.saved(msg, 'the response of a delivered destination',
      this.store.storeContent(channelId, msg.messageId, msg.metaDataId, CONTENT_TYPE.RESPONSE, response, 'TEXT'));
    // An earlier attempt left why it failed; a delivered message must not show it.
    if (this.store.removeContent) {
      const cleared = await this.saved(msg, 'the removal of why an earlier attempt failed',
        this.store.removeContent(channelId, msg.messageId, msg.metaDataId, CONTENT_TYPE.ERROR));
      if (!cleared.ok) {
        await this.alert(
          `Queued destination ${String(msg.metaDataId)} delivered message ${String(msg.messageId)}, but the reason an ` +
          `earlier attempt failed could not be removed: ${cleared.error.message}. The message still shows it.`,
        );
      }
    }
    const released = await this.saved(msg, STATUS_OF.SENT, this.store.release(channelId, msg.messageId, msg.metaDataId, 'SENT'));
    if (!released.ok) {
      await this.reportUnrecorded(msg, 'SENT', released.error.message);
      return;
    }
    // Not before: it would use up the alert that says the message is sent again.
    if (!stored.ok) {
      await this.alert(
        `Queued destination ${String(msg.metaDataId)} delivered message ${String(msg.messageId)}, but its response could not be saved: ` +
        `${stored.error.message}. A response the message shows is from an earlier attempt.`,
      );
    }
    await this.saved(msg, 'the count of a delivered destination', this.store.incrementStats(channelId, msg.metaDataId, serverId, 'sent'));
    // Before the content goes: the source needs the raw content it dispatched.
    await this.notifyDelivered(msg);
    await this.removeDeliveredContent(msg);
  }

  /** Tell the source when this delivery was the last one the message waited for. */
  private async notifyDelivered(msg: QueuedMessage): Promise<void> {
    const { onMessageDelivered } = this.config;
    if (!onMessageDelivered || !this.store.isFullyDelivered) return;
    const what = `delivered message ${String(msg.messageId)}, but the source's after-processing action`;
    const delivered = await this.store.isFullyDelivered(this.config.channelId, msg.messageId);
    if (!delivered.ok) {
      await this.alert(`Queued destination ${String(msg.metaDataId)} ${what} did not run: the message's state could not be read: ${delivered.error.message}`);
      return;
    }
    if (!delivered.value) return;
    const raw = await this.store.loadContent(this.config.channelId, msg.messageId, 0, CONTENT_TYPE.RAW);
    if (!raw.ok) {
      await this.alert(`Queued destination ${String(msg.metaDataId)} ${what} did not run: ${raw.error.message}`);
      return;
    }
    // Gone: the pipeline saw the message finished too, ran the action itself
    // and removed the content on completion. Queues need RAW stored (deploy
    // refuses a storage mode without it), so nothing else empties it.
    if (raw.value === null) return;
    try {
      await onMessageDelivered(msg.messageId, raw.value);
    } catch (e) {
      const cause = e instanceof Error ? e.message : String(e);
      await this.alert(`Queued destination ${String(msg.metaDataId)} ${what} failed: ${cause}`);
    }
  }

  /** Apply the channel's remove-content-on-completion setting now that this delivery is done. */
  private async removeDeliveredContent(msg: QueuedMessage): Promise<void> {
    if (!this.store.removeContentIfDelivered) return;
    const removed = await this.saved(msg, 'the removal of the content of a completed message',
      this.store.removeContentIfDelivered(this.config.channelId, msg.messageId));
    if (removed.ok) return;
    await this.alert(
      `Queued destination ${String(msg.metaDataId)} delivered message ${String(msg.messageId)} but its stored ` +
      `content could not be removed: ${removed.error.message}. The content stays until the pruner removes it.`,
    );
  }

  /** A row whose status was not saved stays PENDING, and deploy re-queues PENDING rows, so it is retried, never lost. */
  private async reportUnrecorded(msg: QueuedMessage, what: string, cause: string): Promise<void> {
    await this.alert(
      `Queued destination ${String(msg.metaDataId)} could not save ${what} for message ` +
      `${String(msg.messageId)}: ${cause}. It stays PENDING and is re-queued on the next deploy.`,
    );
  }

  private async saved(msg: QueuedMessage, what: string, write: Promise<Result<void>>): Promise<Result<void>> {
    await reportUnsaved([write], { channelId: this.config.channelId, messageId: msg.messageId, metaDataId: msg.metaDataId, what }, this.config.onStoreFailure);
    return write;
  }

  private storeReason(msg: QueuedMessage, reason: string): Promise<Result<void>> {
    return this.saved(msg, 'why a destination failed', this.store.storeContent(this.config.channelId, msg.messageId, msg.metaDataId, CONTENT_TYPE.ERROR, reason, 'TEXT'));
  }

  private async alertOnce(errorMessage: string): Promise<void> {
    if (this.failureAlerted) return;
    this.failureAlerted = true;
    await this.alert(errorMessage);
  }

  private async alert(errorMessage: string): Promise<void> {
    if (!this.config.onError) return;
    await this.config.onError({
      channelId: this.config.channelId,
      errorType: 'DESTINATION_CONNECTOR',
      errorMessage,
      timestamp: Date.now(),
    });
  }

  /** Keeps the reason and alerts, so a message the queue gives up on is never silently dropped. */
  private async giveUp(msg: QueuedMessage, reason: string): Promise<void> {
    const { channelId, serverId } = this.config;
    await this.storeReason(msg, reason);
    const released = await this.saved(msg, STATUS_OF.ERROR, this.store.release(channelId, msg.messageId, msg.metaDataId, 'ERROR'));
    if (!released.ok) {
      await this.reportUnrecorded(msg, `ERROR (${reason})`, released.error.message);
      return;
    }
    await this.saved(msg, 'the count of a failed destination', this.store.incrementStats(channelId, msg.metaDataId, serverId, 'errored'));
    await this.alert(`Queued destination ${String(msg.metaDataId)} gave up on message ${String(msg.messageId)}: ${reason}`);
  }
}
