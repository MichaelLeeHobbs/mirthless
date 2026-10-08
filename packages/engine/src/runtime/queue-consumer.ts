// ===========================================
// Queue Consumer
// ===========================================
// Polls for queued messages and processes them through destination connectors.
// Uses SKIP LOCKED to allow concurrent consumers.

import type { Result } from '@mirthless/core-util';
import type { MessageStore, DestinationResponse, SendToDestination, AlertEventHandler } from '../pipeline/message-processor.js';

// ----- Types -----

export interface QueueConsumerConfig {
  readonly channelId: string;
  readonly metaDataId: number;
  readonly serverId: string;
  readonly retryCount: number;
  readonly retryIntervalMs: number;
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

export class QueueConsumer {
  private readonly config: QueueConsumerConfig;
  private readonly store: MessageStore;
  private readonly sendFn: SendToDestination;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

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
    this.schedulePoll();
  }

  /** Stop polling and wait for current batch to finish. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Execute one poll cycle. Exposed for testing. */
  async poll(): Promise<void> {
    const dequeueResult = await this.store.dequeue(
      this.config.channelId,
      this.config.metaDataId,
      this.config.batchSize,
    );

    if (!dequeueResult.ok) return;

    const messages = dequeueResult.value as readonly QueuedMessage[];
    for (const msg of messages) {
      await this.processQueuedMessage(msg);
    }
  }

  private schedulePoll(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.poll();
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  private async processQueuedMessage(msg: QueuedMessage): Promise<void> {
    const signal = AbortSignal.timeout(30_000);

    const contentResult = await this.store.loadContent(
      msg.channelId, msg.messageId, msg.metaDataId, CT_SENT,
    );

    if (!contentResult.ok || contentResult.value === null) {
      await this.giveUp(msg, 'Queued message has no stored SENT content to deliver');
      return;
    }

    const sendResult: Result<DestinationResponse> = await this.sendFn(
      msg.metaDataId,
      msg.messageId,
      contentResult.value,
      signal,
    );

    if (sendResult.ok && sendResult.value.status === 'SENT') {
      // Keep the destination's response, as the direct-send path does, so the
      // message browser shows it for queued deliveries too.
      await this.store.storeContent(msg.channelId, msg.messageId, msg.metaDataId, CT_RESPONSE, sendResult.value.content, 'TEXT');
      await this.store.release(this.config.channelId, msg.messageId, msg.metaDataId, 'SENT');
      await this.store.incrementStats(
        this.config.channelId, msg.metaDataId, this.config.serverId, 'sent',
      );
      return;
    }

    // Send failed — check retry count
    const attempts = (msg.sendAttempts ?? 0) + 1;
    if (attempts >= this.config.retryCount) {
      const reason = sendResult.ok
        ? (sendResult.value.errorMessage ?? sendResult.value.content)
        : sendResult.error.message;
      await this.giveUp(msg, `Delivery failed after ${String(attempts)} attempt(s): ${reason}`);
      return;
    }

    // Re-queue for retry. Transitioning back to QUEUED persists an incremented
    // send_attempts (see MessageService.updateConnectorMessageStatus) so the
    // retry cap above eventually trips and a poison message is not retried forever.
    await this.store.updateConnectorMessageStatus(
      this.config.channelId, msg.messageId, msg.metaDataId, 'QUEUED',
    );
  }

  /**
   * Final failure: mark ERROR, keep the reason as error content and raise an
   * alert, so a message the queue gives up on is never silently dropped.
   */
  private async giveUp(msg: QueuedMessage, reason: string): Promise<void> {
    const { channelId, serverId } = this.config;
    await this.store.storeContent(channelId, msg.messageId, msg.metaDataId, CT_ERROR, reason, 'TEXT');
    await this.store.release(channelId, msg.messageId, msg.metaDataId, 'ERROR');
    await this.store.incrementStats(channelId, msg.metaDataId, serverId, 'errored');
    if (this.config.onError) {
      await this.config.onError({
        channelId,
        errorType: 'DESTINATION_CONNECTOR',
        errorMessage: `Queued destination ${String(msg.metaDataId)} gave up on message ${String(msg.messageId)}: ${reason}`,
        timestamp: Date.now(),
      });
    }
  }
}
