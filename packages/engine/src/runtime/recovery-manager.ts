// ===========================================
// Recovery Manager
// ===========================================
// Recovers unprocessed messages after a channel restart.
// Queries messages where processed=false and routes them based on
// connector status and metaDataId.

import { tryCatch, type Result } from '@mirthless/core-util';

// ----- Types -----

/** A minimal unprocessed message record. */
export interface UnprocessedMessage {
  readonly messageId: number;
  readonly channelId: string;
}

/** A minimal connector message record for recovery decisions. */
export interface ConnectorMessageRecord {
  readonly messageId: number;
  readonly metaDataId: number;
  readonly status: string;
}

/** Store interface needed by the recovery manager. */
export interface RecoveryStore {
  getUnprocessedMessages(channelId: string): Promise<Result<readonly UnprocessedMessage[]>>;
  getConnectorMessages(channelId: string, messageId: number): Promise<Result<readonly ConnectorMessageRecord[]>>;
}

/** Callback to reprocess a message from source. */
export type ReprocessSourceFn = (channelId: string, messageId: number) => Promise<Result<void>>;

/** Callback to re-dispatch a destination message. */
export type RedispatchDestinationFn = (channelId: string, messageId: number, metaDataId: number) => Promise<Result<void>>;

/** Recovery result summary. */
export interface RecoveryResult {
  readonly recovered: number;
  readonly errors: number;
  readonly skipped: number;
}

// ----- Manager -----

export class RecoveryManager {
  private readonly store: RecoveryStore;
  private readonly reprocessSource: ReprocessSourceFn;
  private readonly redispatchDestination: RedispatchDestinationFn;

  constructor(
    store: RecoveryStore,
    reprocessSource: ReprocessSourceFn,
    redispatchDestination: RedispatchDestinationFn,
  ) {
    this.store = store;
    this.reprocessSource = reprocessSource;
    this.redispatchDestination = redispatchDestination;
  }

  /** Recover all unprocessed messages for a channel. */
  async recover(channelId: string): Promise<Result<RecoveryResult>> {
    return tryCatch(async () => {
      const msgResult = await this.store.getUnprocessedMessages(channelId);
      if (!msgResult.ok) {
        throw new Error(`Failed to get unprocessed messages: ${msgResult.error.message}`);
      }

      const messages = msgResult.value;

      // Process messages concurrently — they are independent
      const results = await Promise.all(
        messages.map(async (msg) => this.recoverMessage(channelId, msg.messageId)),
      );

      let recovered = 0;
      let errors = 0;
      let skipped = 0;
      for (const r of results) {
        recovered += r.recovered;
        errors += r.errors;
        skipped += r.skipped;
      }

      return { recovered, errors, skipped };
    });
  }

  /** Recover a single message's connectors. */
  private async recoverMessage(
    channelId: string,
    messageId: number,
  ): Promise<{ recovered: number; errors: number; skipped: number }> {
    const connResult = await this.store.getConnectorMessages(channelId, messageId);
    if (!connResult.ok) {
      return { recovered: 0, errors: 1, skipped: 0 };
    }

    const connectors = connResult.value;
    let messageRecovered = false;
    let errors = 0;
    let skipped = 0;

    for (const conn of connectors) {
      // QUEUED messages are handled by QueueConsumer — skip
      if (conn.status === 'QUEUED') {
        skipped++;
        continue;
      }

      // Source connector (metaDataId=0) with RECEIVED status — full reprocess
      if (conn.metaDataId === 0 && conn.status === 'RECEIVED') {
        const rpResult = await this.reprocessSource(channelId, messageId);
        if (rpResult.ok) {
          messageRecovered = true;
        } else {
          errors++;
        }
        continue;
      }

      // Destination connector with RECEIVED status — re-dispatch
      if (conn.metaDataId > 0 && conn.status === 'RECEIVED') {
        const rdResult = await this.redispatchDestination(channelId, messageId, conn.metaDataId);
        if (rdResult.ok) {
          messageRecovered = true;
        } else {
          errors++;
        }
        continue;
      }

      // Other statuses (SENT, FILTERED, ERROR, TRANSFORMED) — skip
      skipped++;
    }

    return { recovered: messageRecovered ? 1 : 0, errors, skipped };
  }
}
