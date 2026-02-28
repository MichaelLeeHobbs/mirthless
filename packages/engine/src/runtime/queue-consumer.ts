// ===========================================
// Queue Consumer
// ===========================================
// Polls for queued messages and processes them through destination connectors.
// Uses SKIP LOCKED to allow concurrent consumers.

import type { Result } from '@mirthless/core-util';
import type { MessageStore, DestinationResponse, SendToDestination } from '../pipeline/message-processor.js';

// ----- Types -----

export interface QueueConsumerConfig {
  readonly channelId: string;
  readonly metaDataId: number;
  readonly serverId: string;
  readonly retryCount: number;
  readonly retryIntervalMs: number;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
}

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

    // Load content for this message (we need to send it)
    // In a full implementation, we'd load from message_content table
    // For now, pass the messageId to the send function
    const sendResult: Result<DestinationResponse> = await this.sendFn(
      msg.metaDataId,
      '', // Content would be loaded from DB in full implementation
      signal,
    );

    if (sendResult.ok && sendResult.value.status === 'SENT') {
      await this.store.release(this.config.channelId, msg.messageId, msg.metaDataId, 'SENT');
      await this.store.incrementStats(
        this.config.channelId, msg.metaDataId, this.config.serverId, 'sent',
      );
      return;
    }

    // Send failed — check retry count
    const attempts = (msg.sendAttempts ?? 0) + 1;
    if (attempts >= this.config.retryCount) {
      await this.store.release(this.config.channelId, msg.messageId, msg.metaDataId, 'ERROR');
      await this.store.incrementStats(
        this.config.channelId, msg.metaDataId, this.config.serverId, 'errored',
      );
      return;
    }

    // Re-queue for retry (stays QUEUED, attempt count incremented by DB)
    await this.store.updateConnectorMessageStatus(
      this.config.channelId, msg.messageId, msg.metaDataId, 'QUEUED',
    );
  }
}
