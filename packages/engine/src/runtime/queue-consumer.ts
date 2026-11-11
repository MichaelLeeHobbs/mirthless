// ===========================================
// Queue Consumer
// ===========================================
// Polls for queued messages and processes them through destination connectors.
// Uses SKIP LOCKED to allow concurrent consumers.

import type { Result } from '@galvaniflow/core-util';
import type { MessageStore, DestinationResponse, SendToDestination, AlertEventHandler } from '../pipeline/message-processor.js';

// ----- Types -----

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
}

/** Content types written by the consumer (see CONTENT_TYPE in core-models). */
const CT_SENT = 5;
const CT_RESPONSE = 6;
const CT_ERROR = 11;

interface QueuedMessage {
  readonly channelId: string;
  readonly messageId: number;
  readonly metaDataId: number;
  readonly sendAttempts: number;
}

// ----- Consumer -----

/** What happened to one queued message. RETRY_LATER means it failed and is back on the queue. */
type Outcome = 'DONE' | 'RETRY_LATER';

export class QueueConsumer {
  private readonly config: QueueConsumerConfig;
  private readonly store: MessageStore;
  private readonly sendFn: SendToDestination;
  private running = false;
  private stopRequested = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The poll cycle currently running, so stop() can wait for it. */
  private inFlight: Promise<void> | null = null;
  /** No delivery is attempted before this time (set after a failed send). */
  private retryNotBefore = 0;
  private queueReadFailing = false;
  /** A delivery failure has been alerted and nothing has been delivered since. */
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

  /** Start polling for queued messages. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
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

  /**
   * Execute one poll cycle. Exposed for testing.
   *
   * Messages are delivered in message order. When a send fails and will be
   * retried, the messages behind it are held and nothing is attempted again until
   * retryIntervalMs has passed, so an outage neither reorders the queue nor burns
   * through every message's retries in a few seconds.
   *
   * With `rotate` on, a failure does not hold the queue: the rest of the batch is
   * still attempted, and the wait applies only when every message in it failed.
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
    // Rotating: wait only when nothing in the batch could be delivered.
    if (failed > 0 && failed === messages.length) {
      this.retryNotBefore = Date.now() + this.config.retryIntervalMs;
    }
  }

  /** Return claimed-but-unsent messages to the queue. No attempt was made, so none is counted. */
  private async putBack(messages: readonly QueuedMessage[]): Promise<void> {
    for (const msg of messages) {
      const released = await this.store.release(this.config.channelId, msg.messageId, msg.metaDataId, 'QUEUED');
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
    const signal = AbortSignal.timeout(30_000);

    const contentResult = await this.store.loadContent(
      msg.channelId, msg.messageId, msg.metaDataId, CT_SENT,
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

    const sendResult: Result<DestinationResponse> = await this.sendFn(
      msg.metaDataId,
      msg.messageId,
      contentResult.value,
      signal,
    );

    if (sendResult.ok && sendResult.value.status === 'SENT') {
      this.failureAlerted = false;
      await this.finishSent(msg, sendResult.value.content);
      return 'DONE';
    }

    // Send failed. retryCount is the number of retries AFTER the first attempt;
    // 0 means keep retrying until the message is delivered.
    const attempts = (msg.sendAttempts ?? 0) + 1;
    const reason = sendResult.ok
      ? (sendResult.value.errorMessage ?? sendResult.value.content)
      : sendResult.error.message;
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

    // Re-queue for retry. Transitioning back to QUEUED persists an incremented
    // send_attempts (see MessageService.updateConnectorMessageStatus), which the
    // retry cap above counts.
    const requeued = await this.store.updateConnectorMessageStatus(
      this.config.channelId, msg.messageId, msg.metaDataId, 'QUEUED',
    );
    if (!requeued.ok) await this.reportUnrecorded(msg, 'QUEUED', requeued.error.message);
    return 'RETRY_LATER';
  }

  /** Delivered: keep the response, mark SENT, then count it. */
  private async finishSent(msg: QueuedMessage, response: string): Promise<void> {
    const { channelId, serverId } = this.config;
    // Keep the destination's response, as the direct-send path does, so the
    // message browser shows it for queued deliveries too.
    const stored = await this.store.storeContent(channelId, msg.messageId, msg.metaDataId, CT_RESPONSE, response, 'TEXT');
    if (!stored.ok) await this.reportUnrecorded(msg, 'response content', stored.error.message);
    const released = await this.store.release(channelId, msg.messageId, msg.metaDataId, 'SENT');
    if (!released.ok) {
      await this.reportUnrecorded(msg, 'SENT', released.error.message);
      return;
    }
    await this.store.incrementStats(channelId, msg.metaDataId, serverId, 'sent');
    await this.removeDeliveredContent(msg);
  }

  /** Apply the channel's remove-content-on-completion setting now that this delivery is done. */
  private async removeDeliveredContent(msg: QueuedMessage): Promise<void> {
    if (!this.store.removeContentIfDelivered) return;
    const removed = await this.store.removeContentIfDelivered(this.config.channelId, msg.messageId);
    if (removed.ok) return;
    await this.alert(
      `Queued destination ${String(msg.metaDataId)} delivered message ${String(msg.messageId)} but its stored ` +
      `content could not be removed: ${removed.error.message}. The content stays until the pruner removes it.`,
    );
  }

  /**
   * A persistence write failed. Raise it as an alert instead of carrying on as
   * if the message were finalized. A row whose status was not saved stays
   * PENDING, and deploy re-queues PENDING rows, so it is retried, never lost.
   */
  private async reportUnrecorded(msg: QueuedMessage, what: string, cause: string): Promise<void> {
    await this.alert(
      `Queued destination ${String(msg.metaDataId)} could not save ${what} for message ` +
      `${String(msg.messageId)}: ${cause}. It stays PENDING and is re-queued on the next deploy.`,
    );
  }

  /** Alert on the first failure of a streak, not on every retry. */
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

  /**
   * Final failure: mark ERROR, keep the reason as error content and raise an
   * alert, so a message the queue gives up on is never silently dropped.
   */
  private async giveUp(msg: QueuedMessage, reason: string): Promise<void> {
    const { channelId, serverId } = this.config;
    const stored = await this.store.storeContent(channelId, msg.messageId, msg.metaDataId, CT_ERROR, reason, 'TEXT');
    if (!stored.ok) await this.reportUnrecorded(msg, 'the error reason', stored.error.message);
    const released = await this.store.release(channelId, msg.messageId, msg.metaDataId, 'ERROR');
    if (!released.ok) {
      await this.reportUnrecorded(msg, `ERROR (${reason})`, released.error.message);
      return;
    }
    await this.store.incrementStats(channelId, msg.metaDataId, serverId, 'errored');
    await this.alert(`Queued destination ${String(msg.metaDataId)} gave up on message ${String(msg.messageId)}: ${reason}`);
  }
}
