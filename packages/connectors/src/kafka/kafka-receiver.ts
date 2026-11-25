// At-least-once: an offset is committed only after the pipeline stored the record. A record
// not stored is read again after a rejoin, and so is one stored just before a crash (the
// source map's topic/partition/offset identify the duplicate). A record refused every time
// would block its partition forever, so after `maxStoreAttempts` failures in a row the
// receiver stops the channel and leaves it uncommitted.

import { settleUnlessAborted, settleWithin, tryCatch, type Result } from '@galvanigraph/core-util';
import type { SourceConnectorRuntime, SourceFatalHandler, MessageDispatcher, RawMessage, DispatchResult } from '../base.js';
import { dispatchFailure } from '../base.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
import { withTimeout } from '../timeout.js';
import { closeQuietly, HALT_CLOSE_MS, STOP_CLOSE_MS } from '../client-lifecycle.js';
import { decodePayload, INVALID_UTF8_MESSAGE } from '../encoding.js';
import { DEFAULT_MAX_STORE_ATTEMPTS, type QueueCharset } from '@galvanigraph/core-models';
import {
  subscribeKafka,
  parseBrokers,
  type KafkaConnectionConfig,
  type KafkaInboundRecord,
  type KafkaSubscribe,
  type KafkaSubscription,
} from './kafka-client.js';

/** Wait before rejoining after a failure, so a down broker is not hammered. */
const DEFAULT_RETRY_DELAY_MS = 5_000;
const KAFKA_OP_TIMEOUT_MS = 30_000;
/** How long a start or an undeploy waits for the record that a halt left in hand. */
const EARLIER_ENDS_MS = 10_000;

export interface KafkaReceiverConfig extends KafkaConnectionConfig {
  readonly topic: string;
  readonly groupId: string;
  readonly startFrom: 'EARLIEST' | 'LATEST';
  /** How a record value becomes message text; UTF-8 when absent. */
  readonly charset?: QueueCharset;
  /** Failures in a row on one record before the receiver stops; DEFAULT_MAX_STORE_ATTEMPTS when absent. */
  readonly maxStoreAttempts?: number;
}

/** For logs and errors, which never carry the record's content. */
interface RecordPosition {
  readonly topic: string;
  readonly partition: number;
  readonly offset: string;
}

/** `fromEntries`, because assigning a header named `__proto__` sets no property. */
function headersToRecord(headers: ReadonlyMap<Buffer, Buffer>): Record<string, string> {
  return Object.fromEntries([...headers].map(([name, value]) => [name.toString('utf8'), value.toString('utf8')]));
}

/** A value that is not valid UTF-8 (in UTF-8 mode) gets a `charsetError` in the source map. */
export function toRawMessage(record: KafkaInboundRecord, charset: QueueCharset = 'utf-8'): RawMessage {
  const decoded = record.value ? decodePayload(record.value, charset) : { text: '', replaced: false };
  return {
    content: decoded.text,
    sourceMap: {
      topic: record.topic,
      partition: record.partition,
      offset: record.offset.toString(),
      key: record.key?.toString('utf8') ?? null,
      headers: headersToRecord(record.headers),
      timestamp: Number(record.timestamp),
      ...(decoded.replaced ? { charsetError: INVALID_UTF8_MESSAGE } : {}),
    },
  };
}

/** One start of the source. A record that outlives a halt is committed on its own subscription. */
interface Run {
  subscription: KafkaSubscription | null;
  /** False once the source stops, is halted or gives up: it takes no more records. */
  live: boolean;
  readonly halted: AbortController;
  /** The record being dispatched and committed. */
  inHand: Promise<boolean> | null;
  loop: Promise<void>;
  wake: (() => void) | null;
}

export class KafkaReceiver implements SourceConnectorRuntime {
  private readonly config: KafkaReceiverConfig;
  private readonly subscribe: KafkaSubscribe;
  private readonly logger: ConnectorLogger;
  private readonly retryDelayMs: number;
  private dispatcher: MessageDispatcher | null = null;
  private run: Run | null = null;
  /** The run before it: a halt may have left a record of it in hand. */
  private earlier: Run | null = null;
  private onFatal: SourceFatalHandler | null = null;
  private readonly failures = new Map<string, number>();

  constructor(config: KafkaReceiverConfig, subscribe?: KafkaSubscribe, logger?: ConnectorLogger, retryDelayMs?: number) {
    this.config = config;
    this.subscribe = subscribe ?? subscribeKafka;
    this.logger = logger ?? createConnectorLogger('KAFKA');
    this.retryDelayMs = retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  setFatalHandler(handler: SourceFatalHandler): void {
    this.onFatal = handler;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (parseBrokers(this.config.brokers).length === 0) throw new Error('At least one broker is required');
      if (!this.config.topic) throw new Error('Topic is required');
      if (!this.config.groupId) throw new Error('Consumer group is required');
    });
  }

  /** Join the group; a broker that cannot be reached fails the start. */
  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) throw new Error('Dispatcher not set — call setDispatcher before start');
      const run: Run = { subscription: null, live: true, halted: new AbortController(), inHand: null, loop: Promise.resolve(), wake: null };
      // Before the waits, so that a stop, halt or undeploy in the middle of them ends this one.
      this.earlier = this.run;
      this.run = run;
      await this.earlierEnds();
      if (run.live) run.subscription = await this.subscribe(this.config);
      if (!run.live) {
        await this.closeSubscription(run, true, HALT_CLOSE_MS);
        throw new Error('The source was stopped before it had started');
      }
      this.failures.clear();
      run.loop = this.consumeWhileLive(run);
    });
  }

  /** The next member of the group would be given its partition, and with it the record, or wait for it. */
  private async earlierEnds(): Promise<void> {
    const run = [this.earlier, this.run].find((candidate) => candidate?.inHand);
    if (!run?.inHand || await settleWithin(run.inHand, EARLIER_ENDS_MS)) return;
    this.logger.warn({ topic: this.config.topic }, 'A Kafka record that a halt left in hand has not ended; it is not committed and may be read again');
    await this.closeSubscription(run, true, HALT_CLOSE_MS);
  }

  /** Waits for the record in hand, however long it takes, until a halt. */
  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      const { run } = this;
      if (!run) return;
      run.live = false;
      run.wake?.();
      if (run.inHand !== null && !(await settleUnlessAborted(run.inHand, run.halted.signal))) return;
      await this.closeSubscription(run, false, STOP_CLOSE_MS);
      await settleWithin(run.loop, HALT_CLOSE_MS, run.halted.signal);
    });
  }

  /** Does not wait: the loop keeps the subscription for a record in hand, commits it and leaves the group. */
  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      const { run } = this;
      if (!run) return;
      run.live = false;
      run.wake?.();
      run.halted.abort();
      if (run.inHand === null) await this.closeSubscription(run, true, HALT_CLOSE_MS);
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
      if (this.run) this.run.live = false;
      await this.earlierEnds();
    });
  }

  private async consumeWhileLive(run: Run): Promise<void> {
    while (run.live) {
      try {
        run.subscription ??= await this.subscribe(this.config);
        // A stop or halt during the subscribe above must not leave it open.
        if (run.live) await this.consume(run, run.subscription);
      } catch (err) {
        if (run.live) {
          this.logger.error({ ...errorInfo(err), topic: this.config.topic }, 'Kafka consumer failed; rejoining from the last committed offset');
        }
      }
      await this.closeSubscription(run, run.live || run.halted.signal.aborted, STOP_CLOSE_MS);
      if (run.live) await this.pause(run);
    }
  }

  private async consume(run: Run, subscription: KafkaSubscription): Promise<void> {
    for await (const record of subscription) {
      if (!run.live) return;
      run.inHand = this.handle(run, record);
      const stored = await run.inHand;
      run.inHand = null;
      if (!stored || !run.live) return;
    }
    if (run.live) this.logger.warn({ topic: this.config.topic }, 'Kafka stream ended; rejoining');
  }

  /** A throw becomes a failed result, so it counts toward the cap like any record not stored. */
  private async dispatchRecord(dispatcher: MessageDispatcher, record: KafkaInboundRecord, where: RecordPosition, onStored: RawMessage['onStored']): Promise<Result<DispatchResult>> {
    return tryCatch(async () => {
      const raw = { ...toRawMessage(record, this.config.charset), onStored };
      if (raw.sourceMap['charsetError']) {
        this.logger.warn({ ...where }, 'Kafka record value is not valid UTF-8; invalid bytes were replaced and the message is flagged (charsetError in the source map)');
      }
      const result = await dispatcher(raw);
      if (!result.ok) throw result.error;
      return result.value;
    });
  }

  private async handle(run: Run, record: KafkaInboundRecord): Promise<boolean> {
    const dispatcher = this.dispatcher;
    if (!dispatcher) return false;
    const where = { topic: record.topic, partition: record.partition, offset: record.offset.toString() };
    let rawKept = false;
    const result = await this.dispatchRecord(dispatcher, record, where, ({ recoverable }) => { rawKept = recoverable; });
    const position = `${String(record.partition)}:${where.offset}`;
    if (!result.ok) {
      // A failure that comes back after a stop or halt (the pipeline was being
      // shut down) is not the record's fault, and must not stop a later start.
      if (run.live) this.notStored(run, position, result.error, where);
      else this.logger.warn({ ...errorInfo(result.error), ...where }, 'Pipeline did not store the Kafka record while the source was stopping; it is not committed and will be read again');
      return false;
    }
    this.failures.delete(position);
    const failure = dispatchFailure(result);
    if (run.halted.signal.aborted && !rawKept && (failure !== null || result.value.destinationFailed === true)) {
      this.logger.warn({ ...where, messageId: result.value.messageId }, 'A halt ended a Kafka record whose content the channel does not keep; it is not committed and will be read again');
      return false;
    }
    if (failure) {
      // Stored with an error and alerted; reading it again would process it twice.
      this.logger.error({ ...errorInfo(failure), ...where }, 'Kafka record stored with an ERROR status; committing so it is not processed twice');
    }
    try {
      await withTimeout(record.commit(), KAFKA_OP_TIMEOUT_MS, 'Kafka commit');
    } catch (err) {
      // A later commit in this partition covers it; if none comes, the record is read again.
      this.logger.error({ ...errorInfo(err), ...where }, 'Kafka offset commit failed; the record may be delivered again');
    }
    return true;
  }

  private notStored(run: Run, position: string, cause: Error, where: RecordPosition): void {
    const attempts = (this.failures.get(position) ?? 0) + 1;
    this.failures.set(position, attempts);
    if (attempts >= (this.config.maxStoreAttempts ?? DEFAULT_MAX_STORE_ATTEMPTS)) {
      this.giveUp(run, cause, where, attempts);
      return;
    }
    this.logger.error({ ...errorInfo(cause), ...where, attempts }, 'Pipeline did not store the Kafka record; it is not committed and will be read again');
  }

  /** The record stays uncommitted, so a restart reads it first. */
  private giveUp(run: Run, cause: Error, where: RecordPosition, attempts: number): void {
    run.live = false;
    const error = new Error(
      `Kafka source stopped: the channel could not store the record at topic ${where.topic} partition ${String(where.partition)} ` +
      `offset ${where.offset} after ${String(attempts)} attempts (${cause.message}). The record is not committed; ` +
      'fix the cause and start the channel again.',
    );
    this.logger.error({ ...errorInfo(cause), ...where, attempts }, 'Kafka source stopped: the record failed too many times in a row; it is not committed');
    this.onFatal?.(error);
  }

  private async closeSubscription(run: Run, force: boolean, timeoutMs: number): Promise<void> {
    const { subscription } = run;
    if (!subscription) return;
    run.subscription = null;
    await closeQuietly({
      close: () => subscription.close(force),
      timeoutMs,
      label: 'Kafka close',
      logger: this.logger,
      message: 'Error closing Kafka consumer',
    });
  }

  private async pause(run: Run): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.retryDelayMs);
      run.wake = (): void => { clearTimeout(timer); resolve(); };
    });
    run.wake = null;
  }
}
