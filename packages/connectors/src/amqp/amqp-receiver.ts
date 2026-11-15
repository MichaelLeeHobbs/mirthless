// ===========================================
// AMQP Receiver (Source Connector)
// ===========================================
// Consumes an existing queue one message at a time and acknowledges a message
// only after the pipeline has stored it. A message the pipeline could not take
// goes back to the queue (after a pause, so a down database is not hammered)
// and is delivered again first. A message stored with an ERROR status is
// rejected without requeue, which sends it to the queue's dead-letter exchange
// if one is configured. A crash or lost connection between storing and
// acknowledging delivers the message again (at-least-once); such a message has
// `redelivered: true` in the source map.
//
// A message the pipeline refuses every time (one the store rejects) would come
// back forever. After `maxStoreAttempts` failures on the same message (counted
// per message id, or in a row for a message without one) the receiver stops
// without acknowledging or rejecting it, so it stays on the queue, and reports
// a fatal error, which stops the channel. An operator fixes the cause and
// starts it again.

import { tryCatch, type Result } from '@galvaniflow/core-util';
import type { SourceConnectorRuntime, SourceFatalHandler, MessageDispatcher, RawMessage, DispatchResult } from '../base.js';
import { dispatchFailure } from '../base.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
import { withTimeout } from '../timeout.js';
import { assertCharsetAvailable, decodePayload, INVALID_UTF8_MESSAGE } from '../encoding.js';
import { DEFAULT_MAX_STORE_ATTEMPTS, type QueueCharset } from '@galvaniflow/core-models';
import { consumeAmqp, type AmqpConnectionConfig, type AmqpConsume, type AmqpConsumer, type AmqpDelivery } from './amqp-client.js';

/** Wait before reconnecting, and before returning a message the pipeline could not take. */
const DEFAULT_RETRY_DELAY_MS = 5_000;
/** Bound on letting the message in progress finish during a stop, and on closing. */
const AMQP_OP_TIMEOUT_MS = 30_000;

export interface AmqpReceiverConfig extends AmqpConnectionConfig {
  readonly queue: string;
  /** How a message body becomes message text; UTF-8 when absent. */
  readonly charset?: QueueCharset;
  /** Failures in a row before the receiver stops; DEFAULT_MAX_STORE_ATTEMPTS when absent. */
  readonly maxStoreAttempts?: number;
}

/**
 * The message the pipeline receives for a delivery, its body decoded with the
 * source's charset. A body that is not valid UTF-8 (in UTF-8 mode) gets a
 * `charsetError` in the source map, so the stored message shows it.
 */
export function toRawMessage(delivery: AmqpDelivery, queue: string, charset: QueueCharset = 'utf-8'): RawMessage {
  const decoded = decodePayload(delivery.content, charset);
  return {
    content: decoded.text,
    sourceMap: {
      ...(decoded.replaced ? { charsetError: INVALID_UTF8_MESSAGE } : {}),
      queue,
      exchange: delivery.exchange,
      routingKey: delivery.routingKey,
      redelivered: delivery.redelivered,
      headers: delivery.headers,
      ...(delivery.messageId === undefined ? {} : { messageId: delivery.messageId }),
      ...(delivery.contentType === undefined ? {} : { contentType: delivery.contentType }),
    },
  };
}

export class AmqpReceiver implements SourceConnectorRuntime {
  private readonly config: AmqpReceiverConfig;
  private readonly consume: AmqpConsume;
  private readonly logger: ConnectorLogger;
  private readonly retryDelayMs: number;
  private dispatcher: MessageDispatcher | null = null;
  private consumer: AmqpConsumer | null = null;
  private running = false;
  /** Counts starts, so a loop left over from before a halt and restart exits. */
  private generation = 0;
  /** Deliveries are handled one after another, in the order they arrive. */
  private queue: Promise<void> = Promise.resolve();
  /** Ends a wait (between reconnects, or before a requeue) early when the channel stops. */
  private readonly wakers = new Set<() => void>();
  private onFatal: SourceFatalHandler | null = null;
  /**
   * Failures to store, per message id. A message without an id is counted under
   * '' as failures in a row, which assumes it comes back before the messages
   * behind it (true for a classic queue with prefetch 1, not promised by a
   * quorum queue). The broker's `x-delivery-count` is not used: RabbitMQ 4.x
   * does not raise it for a nack with requeue, which is how this source returns
   * a message.
   */
  private readonly failures = new Map<string, number>();

  /** Throws when the configured charset cannot be decoded here, so the deploy fails. */
  constructor(config: AmqpReceiverConfig, consume?: AmqpConsume, logger?: ConnectorLogger, retryDelayMs?: number) {
    assertCharsetAvailable(config.charset);
    this.config = config;
    this.consume = consume ?? consumeAmqp;
    this.logger = logger ?? createConnectorLogger('AMQP');
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
      if (!this.config.host) throw new Error('Host is required');
      if (this.config.port < 1 || this.config.port > 65535) throw new Error('Port must be between 1 and 65535');
      if (!this.config.queue) throw new Error('Queue is required');
    });
  }

  /** Connect and start consuming; a broker that cannot be reached or a missing queue fails the start. */
  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) throw new Error('Dispatcher not set — call setDispatcher before start');
      this.generation += 1;
      const generation = this.generation;
      this.running = true;
      this.failures.clear();
      // A dispatch left hanging by a halt must not hold up this start's deliveries.
      this.queue = Promise.resolve();
      try {
        this.consumer = await this.consume(this.config, (d) => { this.enqueue(generation, d); });
      } catch (err) {
        this.running = false;
        throw err;
      }
      void this.watch(generation, this.consumer);
    });
  }

  /** Let the message in progress finish and be acknowledged, then disconnect; unacknowledged ones return to the queue. */
  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.running = false;
      this.wakeAll();
      await withTimeout(this.queue, AMQP_OP_TIMEOUT_MS, 'AMQP in-flight message').catch(() => undefined);
      await this.closeConsumer();
    });
  }

  /** Disconnect at once; the message in progress returns to the queue. */
  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.running = false;
      this.wakeAll();
      await this.closeConsumer();
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
    });
  }

  private isCurrent(generation: number): boolean {
    return this.running && generation === this.generation;
  }

  /** Reconnect whenever the connection is lost, until stopped. */
  private async watch(generation: number, first: AmqpConsumer): Promise<void> {
    let consumer: AmqpConsumer | null = first;
    while (this.isCurrent(generation)) {
      try {
        if (!consumer) {
          consumer = await this.consume(this.config, (d) => { this.enqueue(generation, d); });
          if (!this.isCurrent(generation)) {
            await consumer.close().catch(() => undefined);
            return;
          }
          this.consumer = consumer;
          this.logger.info({ queue: this.config.queue }, 'AMQP consumer reconnected');
        }
        const reason = await consumer.closed;
        if (this.isCurrent(generation)) {
          this.logger.error({ ...errorInfo(reason), queue: this.config.queue }, 'AMQP connection lost; unacknowledged messages return to the queue; reconnecting');
        }
      } catch (err) {
        if (this.isCurrent(generation)) {
          this.logger.error({ ...errorInfo(err), queue: this.config.queue }, 'AMQP reconnect failed; retrying');
        }
      }
      if (this.consumer === consumer) this.consumer = null;
      // `closed` also settles when only the channel ends (a cancelled consumer,
      // a consumer_timeout); the connection is still open and must be closed.
      if (consumer) await withTimeout(consumer.close(), AMQP_OP_TIMEOUT_MS, 'AMQP close').catch(() => undefined);
      consumer = null;
      if (this.isCurrent(generation)) await this.pause();
    }
  }

  /**
   * Handle deliveries one after another. The chain must never stay rejected:
   * every later delivery would be skipped while the channel shows STARTED.
   */
  private enqueue(generation: number, delivery: AmqpDelivery): void {
    this.queue = this.queue
      .then(() => this.handle(generation, delivery))
      .catch((err: unknown) => {
        this.logger.error({ ...errorInfo(err), queue: this.config.queue, routingKey: delivery.routingKey }, 'AMQP message handling failed unexpectedly; returning it to the queue');
        this.settle({ queue: this.config.queue }, () => { delivery.nack(true); });
      });
  }

  /**
   * Convert and dispatch a delivery. A throw (a decoder that cannot be built, a
   * dispatcher bug) becomes a failed result, so the message goes back to the
   * queue and counts toward the cap like any message the pipeline did not store.
   */
  private async dispatchDelivery(dispatcher: MessageDispatcher, delivery: AmqpDelivery, where: Readonly<Record<string, unknown>>): Promise<Result<DispatchResult>> {
    return tryCatch(async () => {
      const raw = toRawMessage(delivery, this.config.queue, this.config.charset);
      if (raw.sourceMap['charsetError']) {
        this.logger.warn(where, 'AMQP message body is not valid UTF-8; invalid bytes were replaced and the message is flagged (charsetError in the source map)');
      }
      const result = await dispatcher(raw);
      if (!result.ok) throw result.error;
      return result.value;
    });
  }

  /** Dispatch one delivery and settle it with the broker. */
  private async handle(generation: number, delivery: AmqpDelivery): Promise<void> {
    const dispatcher = this.dispatcher;
    // Not acknowledged: the channel closes on stop and the broker requeues it.
    if (!dispatcher || !this.isCurrent(generation)) return;
    const where = { queue: this.config.queue, routingKey: delivery.routingKey, redelivered: delivery.redelivered };
    const result = await this.dispatchDelivery(dispatcher, delivery, where);
    if (!result.ok) {
      await this.notStored(generation, delivery, result.error, where);
      return;
    }
    // A stored message also ends a run of failures on messages without an id.
    this.failures.delete(delivery.messageId ?? '');
    this.failures.delete('');
    const failure = dispatchFailure(result);
    if (failure) {
      this.logger.error({ ...errorInfo(failure), ...where }, 'AMQP message stored with an ERROR status; rejecting it without requeue (to the dead-letter exchange, if the queue has one)');
      this.settle(where, () => { delivery.nack(false); });
      return;
    }
    this.settle(where, () => { delivery.ack(); });
  }

  /**
   * Return a message the pipeline did not store to the queue, or stop at the
   * cap. A failure that comes back after a stop or halt (the pipeline was being
   * shut down) is not counted and never stops a later start.
   */
  private async notStored(generation: number, delivery: AmqpDelivery, cause: Error, where: Readonly<Record<string, unknown>>): Promise<void> {
    if (!this.isCurrent(generation)) {
      this.logger.warn({ ...errorInfo(cause), ...where }, 'Pipeline did not store the AMQP message while the source was stopping; it returns to the queue');
      this.settle(where, () => { delivery.nack(true); });
      return;
    }
    const key = delivery.messageId ?? '';
    const attempts = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, attempts);
    if (attempts >= (this.config.maxStoreAttempts ?? DEFAULT_MAX_STORE_ATTEMPTS)) {
      await this.giveUp(cause, where, attempts);
      return;
    }
    this.logger.error({ ...errorInfo(cause), ...where, attempts }, 'Pipeline did not store the AMQP message; returning it to the queue');
    await this.pause();
    this.settle(where, () => { delivery.nack(true); });
  }

  /**
   * Stop consuming after a message failed too many times. It is neither
   * acknowledged nor rejected: closing the connection returns it to the queue,
   * so a restart delivers it again.
   */
  private async giveUp(cause: Error, where: Readonly<Record<string, unknown>>, attempts: number): Promise<void> {
    this.running = false;
    this.wakeAll();
    this.logger.error({ ...errorInfo(cause), ...where, attempts }, 'AMQP source stopped: the message failed too many times in a row; it stays on the queue');
    await this.closeConsumer();
    this.onFatal?.(new Error(
      `AMQP source stopped: the channel could not store a message from queue ${this.config.queue} after ${String(attempts)} attempts ` +
      `(${cause.message}). The message is still on the queue; fix the cause and start the channel again.`,
    ));
  }

  private settle(where: Record<string, unknown>, action: () => void): void {
    try {
      action();
    } catch (err) {
      this.logger.error({ ...errorInfo(err), ...where }, 'AMQP acknowledgement failed (connection lost); the broker will deliver the message again');
    }
  }

  private async closeConsumer(): Promise<void> {
    const consumer = this.consumer;
    this.consumer = null;
    if (!consumer) return;
    try {
      await withTimeout(consumer.close(), AMQP_OP_TIMEOUT_MS, 'AMQP close');
    } catch (err) {
      this.logger.warn(errorInfo(err), 'Error closing AMQP connection');
    }
  }

  private async pause(): Promise<void> {
    await new Promise<void>((resolve) => {
      const wake = (): void => { clearTimeout(timer); this.wakers.delete(wake); resolve(); };
      const timer = setTimeout(wake, this.retryDelayMs);
      this.wakers.add(wake);
    });
  }

  private wakeAll(): void {
    for (const wake of [...this.wakers]) wake();
  }
}
