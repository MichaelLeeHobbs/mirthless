// ===========================================
// Kafka Receiver (Source Connector)
// ===========================================
// Reads a topic as a member of a consumer group, one record at a time, and
// commits a record's offset only after the pipeline has stored it. A record
// the pipeline could not take is not committed: the receiver drops the
// subscription and rejoins from the last committed offset, so that record is
// read again (at-least-once). A crash between storing and committing also
// reads it again, so a channel may see a duplicate; the source map's
// topic/partition/offset identify one.

import { tryCatch, type Result } from '@galvaniflow/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { dispatchFailure } from '../base.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
import { withTimeout } from '../timeout.js';
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
/** Bound on committing an offset, and on closing a subscription. */
const KAFKA_OP_TIMEOUT_MS = 30_000;

export interface KafkaReceiverConfig extends KafkaConnectionConfig {
  readonly topic: string;
  readonly groupId: string;
  readonly startFrom: 'EARLIEST' | 'LATEST';
}

/** Header names and values as UTF-8 text. */
function headersToRecord(headers: ReadonlyMap<Buffer, Buffer>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of headers) result[name.toString('utf8')] = value.toString('utf8');
  return result;
}

/** The message the pipeline receives for a record. */
export function toRawMessage(record: KafkaInboundRecord): RawMessage {
  return {
    content: record.value?.toString('utf8') ?? '',
    sourceMap: {
      topic: record.topic,
      partition: record.partition,
      offset: record.offset.toString(),
      key: record.key?.toString('utf8') ?? null,
      headers: headersToRecord(record.headers),
      timestamp: Number(record.timestamp),
    },
  };
}

export class KafkaReceiver implements SourceConnectorRuntime {
  private readonly config: KafkaReceiverConfig;
  private readonly subscribe: KafkaSubscribe;
  private readonly logger: ConnectorLogger;
  private readonly retryDelayMs: number;
  private dispatcher: MessageDispatcher | null = null;
  private subscription: KafkaSubscription | null = null;
  private running = false;
  /** Counts starts, so a loop left over from before a halt and restart exits. */
  private generation = 0;
  private loop: Promise<void> | null = null;
  /** The record being dispatched and committed, so a stop can let it finish. */
  private current: Promise<boolean> | null = null;
  /** Ends the wait between attempts early when the channel stops. */
  private wake: (() => void) | null = null;

  constructor(config: KafkaReceiverConfig, subscribe?: KafkaSubscribe, logger?: ConnectorLogger, retryDelayMs?: number) {
    this.config = config;
    this.subscribe = subscribe ?? subscribeKafka;
    this.logger = logger ?? createConnectorLogger('KAFKA');
    this.retryDelayMs = retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
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
      const subscription = await this.subscribe(this.config);
      this.generation += 1;
      this.running = true;
      this.loop = this.run(this.generation, subscription);
    });
  }

  /** Let the record in progress finish and commit, then leave the group. */
  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.running = false;
      this.wake?.();
      if (this.current) await withTimeout(this.current, KAFKA_OP_TIMEOUT_MS, 'Kafka in-flight record').catch(() => false);
      await this.closeSubscription(this.subscription, false);
      await withTimeout(this.loop ?? Promise.resolve(), KAFKA_OP_TIMEOUT_MS, 'Kafka stop').catch(() => undefined);
      this.loop = null;
    });
  }

  /**
   * Leave at once. A record in progress (its dispatch is cancelled by the halt)
   * is not committed, so it is read again on the next start.
   */
  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.running = false;
      this.wake?.();
      await this.closeSubscription(this.subscription, true);
      this.loop = null;
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
    });
  }

  /** True while this loop belongs to the current start. */
  private isCurrent(generation: number): boolean {
    return this.running && generation === this.generation;
  }

  /** Read until stopped; after any failure, wait and rejoin from the committed offsets. */
  private async run(generation: number, first: KafkaSubscription): Promise<void> {
    let subscription: KafkaSubscription | null = first;
    while (this.isCurrent(generation)) {
      try {
        subscription ??= await this.subscribe(this.config);
        this.subscription = subscription;
        // A stop or halt during the subscribe above must not leave it open.
        if (this.isCurrent(generation)) await this.consume(generation, subscription);
      } catch (err) {
        if (this.isCurrent(generation)) {
          this.logger.error({ ...errorInfo(err), topic: this.config.topic }, 'Kafka consumer failed; rejoining from the last committed offset');
        }
      }
      await this.closeSubscription(subscription, true);
      subscription = null;
      if (this.isCurrent(generation)) await this.pause();
    }
  }

  /** Dispatch records in order until one is not stored or the stream ends. */
  private async consume(generation: number, subscription: KafkaSubscription): Promise<void> {
    for await (const record of subscription) {
      if (!this.isCurrent(generation)) return;
      this.current = this.handle(record);
      const stored = await this.current;
      this.current = null;
      if (!stored) return;
    }
    if (this.isCurrent(generation)) this.logger.warn({ topic: this.config.topic }, 'Kafka stream ended; rejoining');
  }

  /** Dispatch one record; commit unless the pipeline did not take it. */
  private async handle(record: KafkaInboundRecord): Promise<boolean> {
    const dispatcher = this.dispatcher;
    if (!dispatcher) return false;
    const where = { topic: record.topic, partition: record.partition, offset: record.offset.toString() };
    const result = await dispatcher(toRawMessage(record));
    if (!result.ok) {
      this.logger.error({ ...errorInfo(result.error), ...where }, 'Pipeline did not store the Kafka record; it is not committed and will be read again');
      return false;
    }
    const failure = dispatchFailure(result);
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

  private async closeSubscription(subscription: KafkaSubscription | null, force: boolean): Promise<void> {
    if (!subscription) return;
    if (this.subscription === subscription) this.subscription = null;
    try {
      await withTimeout(subscription.close(force), KAFKA_OP_TIMEOUT_MS, 'Kafka close');
    } catch (err) {
      this.logger.warn(errorInfo(err), 'Error closing Kafka consumer');
    }
  }

  /** Wait before the next attempt; a stop ends the wait. */
  private async pause(): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.retryDelayMs);
      this.wake = (): void => { clearTimeout(timer); resolve(); };
    });
    this.wake = null;
  }
}
