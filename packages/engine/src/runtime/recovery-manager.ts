import { tryCatch, type Result } from '@galvanigraph/core-util';
import type { RedispatchOutcome } from './destination-redispatcher.js';

export interface UnprocessedMessage {
  readonly messageId: number;
  readonly channelId: string;
}

export interface ConnectorMessageRecord {
  readonly messageId: number;
  readonly metaDataId: number;
  readonly status: string;
}

export interface RecoveryStore {
  /**
   * Unprocessed messages with an id above `afterMessageId`, in id order. Only
   * messages that were already there when the channel was deployed, never ones
   * the running channel is still working on.
   */
  getUnprocessedMessages(channelId: string, afterMessageId: number, limit: number): Promise<Result<readonly UnprocessedMessage[]>>;
  getConnectorMessages(channelId: string, messageId: number): Promise<Result<readonly ConnectorMessageRecord[]>>;
  markProcessed(channelId: string, messageId: number): Promise<Result<void>>;
  /**
   * Give the source connector its final status, as the pipeline would have at
   * the end of the message: ERROR when a destination failed, SENT otherwise.
   */
  finishSource(channelId: string, messageId: number, status: 'SENT' | 'ERROR'): Promise<Result<void>>;
}

export type ReprocessSourceFn = (channelId: string, messageId: number) => Promise<Result<void>>;

/** Not ok when the destination was left as it was, for a later recovery. */
export type RedispatchDestinationFn = (channelId: string, messageId: number, metaDataId: number) => Promise<Result<RedispatchOutcome>>;

export interface RecoveryResult {
  readonly recovered: number;
  readonly errors: number;
  readonly skipped: number;
  /** The channel began to stop first, so messages may be left for the next start. */
  readonly interrupted: boolean;
}

interface MessageOutcome {
  readonly recovered: number;
  readonly errors: number;
  readonly skipped: number;
}

const PAGE_SIZE = 200;
const CONCURRENCY = 5;

/** Nothing has been sent: destinations are sent to only after the source is TRANSFORMED and their rows exist. */
function stoppedBeforeRouting(connectors: readonly ConnectorMessageRecord[]): boolean {
  const source = connectors.find((c) => c.metaDataId === 0);
  return source?.status === 'RECEIVED' || (source?.status === 'TRANSFORMED' && !connectors.some((c) => c.metaDataId > 0));
}

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

  /**
   * A page at a time and a few messages at once, so a large backlog cannot exhaust memory or the database pool.
   * Takes no message once `stop` is aborted: a stopped destination fails every send.
   */
  async recover(channelId: string, stop: AbortSignal): Promise<Result<RecoveryResult>> {
    return tryCatch(async () => {
      const total = { recovered: 0, errors: 0, skipped: 0 };
      let afterMessageId = 0;
      let more = true;
      while (more && !stop.aborted) {
        const page = await this.store.getUnprocessedMessages(channelId, afterMessageId, PAGE_SIZE);
        if (!page.ok) {
          throw new Error(`Failed to get unprocessed messages: ${page.error.message}`);
        }
        for (let i = 0; i < page.value.length && !stop.aborted; i += CONCURRENCY) {
          const results = await Promise.all(
            page.value.slice(i, i + CONCURRENCY).map(async (msg) => this.recoverMessage(channelId, msg.messageId, stop)),
          );
          for (const r of results) {
            total.recovered += r.recovered;
            total.errors += r.errors;
            total.skipped += r.skipped;
          }
        }
        // Page by id, not by offset: a message that fails stays unprocessed
        // and must not be read again in this run.
        afterMessageId = page.value.at(-1)?.messageId ?? afterMessageId;
        more = page.value.length === PAGE_SIZE;
      }
      return { ...total, interrupted: stop.aborted };
    });
  }

  /**
   * A message the crash hit before routing is run again from its raw content, and
   * reprocessSource closes the original. Otherwise each destination still RECEIVED is
   * redispatched, and the message is closed once every destination has an outcome.
   */
  private async recoverMessage(channelId: string, messageId: number, stop: AbortSignal): Promise<MessageOutcome> {
    const connResult = await this.store.getConnectorMessages(channelId, messageId);
    if (!connResult.ok) return { recovered: 0, errors: 1, skipped: 0 };

    const connectors = connResult.value;
    if (stop.aborted) return { recovered: 0, errors: 0, skipped: 0 };
    if (stoppedBeforeRouting(connectors)) {
      const again = await this.reprocessSource(channelId, messageId);
      return again.ok ? { recovered: 1, errors: 0, skipped: 0 } : { recovered: 0, errors: 1, skipped: 0 };
    }

    let recovered = 0;
    let errors = 0;
    let skipped = 0;
    let complete = true;
    for (const conn of connectors) {
      if (stop.aborted) return { recovered, errors, skipped };
      if (conn.status !== 'RECEIVED') {
        skipped++;
        continue;
      }
      const result = await this.redispatchDestination(channelId, messageId, conn.metaDataId);
      if (!result.ok) complete = false;
      if (!result.ok || result.value === 'ERROR') errors++;
      else recovered = 1;
    }

    if (complete && !(await this.closeMessage(channelId, messageId, connectors))) errors++;
    return { recovered, errors, skipped };
  }

  /**
   * A source that had routed the message (TRANSFORMED) never reached its final
   * status because the server stopped first; give it one now, from the
   * destinations as they stand after recovery, so the message does not sit in
   * the browser looking unfinished. A queued destination is the queue's from
   * here on, as it is when the pipeline ends.
   */
  private async closeMessage(
    channelId: string,
    messageId: number,
    before: readonly ConnectorMessageRecord[],
  ): Promise<boolean> {
    const source = before.find((c) => c.metaDataId === 0);
    if (source?.status === 'TRANSFORMED') {
      const now = await this.store.getConnectorMessages(channelId, messageId);
      if (!now.ok) return false;
      const failed = now.value.some((c) => c.metaDataId > 0 && c.status === 'ERROR');
      const finished = await this.store.finishSource(channelId, messageId, failed ? 'ERROR' : 'SENT');
      if (!finished.ok) return false;
    }
    const marked = await this.store.markProcessed(channelId, messageId);
    return marked.ok;
  }
}
