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
  /** Mark a message processed once nothing in it is left to recover. */
  markProcessed(channelId: string, messageId: number): Promise<Result<void>>;
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

  /**
   * Recover a single message.
   *
   * - Source RECEIVED or TRANSFORMED with no destination rows: the crash hit
   *   before routing, so the message is reprocessed from its raw content
   *   (reprocessSource marks the original processed on success).
   * - Destination RECEIVED: re-dispatched. QUEUED: left to the queue consumer.
   * - When nothing was left to do and nothing failed (every connector already
   *   reached a final status, e.g. a crash between the last send and finalize),
   *   the message is marked processed so it is not rescanned on every deploy.
   */
  private async recoverMessage(
    channelId: string,
    messageId: number,
  ): Promise<{ recovered: number; errors: number; skipped: number }> {
    const connResult = await this.store.getConnectorMessages(channelId, messageId);
    if (!connResult.ok) {
      return { recovered: 0, errors: 1, skipped: 0 };
    }

    const connectors = connResult.value;
    const hasDestinations = connectors.some((c) => c.metaDataId > 0);
    let reprocessed = false;
    let messageRecovered = false;
    let pending = false;
    let errors = 0;
    let skipped = 0;

    for (const conn of connectors) {
      const outcome = await this.recoverConnector(channelId, messageId, conn, hasDestinations);
      if (outcome === 'reprocessed') { reprocessed = true; messageRecovered = true; }
      else if (outcome === 'recovered') messageRecovered = true;
      else if (outcome === 'error') errors++;
      else if (outcome === 'queued') { pending = true; skipped++; }
      else skipped++;
    }

    if (!reprocessed && !pending && errors === 0) {
      const marked = await this.store.markProcessed(channelId, messageId);
      if (!marked.ok) errors++;
    }

    return { recovered: messageRecovered ? 1 : 0, errors, skipped };
  }

  private async recoverConnector(
    channelId: string,
    messageId: number,
    conn: ConnectorMessageRecord,
    hasDestinations: boolean,
  ): Promise<'reprocessed' | 'recovered' | 'error' | 'queued' | 'skipped'> {
    // QUEUED messages are handled by QueueConsumer
    if (conn.status === 'QUEUED') return 'queued';

    if (conn.metaDataId === 0) {
      const beforeRouting = conn.status === 'RECEIVED' || (conn.status === 'TRANSFORMED' && !hasDestinations);
      if (!beforeRouting) return 'skipped';
      const rpResult = await this.reprocessSource(channelId, messageId);
      return rpResult.ok ? 'reprocessed' : 'error';
    }

    if (conn.status === 'RECEIVED') {
      const rdResult = await this.redispatchDestination(channelId, messageId, conn.metaDataId);
      return rdResult.ok ? 'recovered' : 'error';
    }

    // SENT, FILTERED, ERROR, ... — final
    return 'skipped';
  }
}
