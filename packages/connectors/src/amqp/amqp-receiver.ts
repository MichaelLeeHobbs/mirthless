// At-least-once (D-266): a message is acked only after the pipeline stores it.
// One the pipeline never stores stops the channel and stays on the queue (D-271).

import { settleUnlessAborted, stderr, tryCatch, type Result } from '@galvanigraph/core-util';
import type { SourceConnectorRuntime, SourceFatalHandler, SourceHealthHandler, MessageDispatcher, RawMessage, DispatchResult } from '../base.js';
import { dispatchFailure } from '../base.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
import { HALT_CLOSE_MS, STOP_CLOSE_MS } from '../client-lifecycle.js';
import { decodePayload, INVALID_UTF8_MESSAGE } from '../encoding.js';
import { DEFAULT_MAX_STORE_ATTEMPTS, type QueueCharset } from '@galvanigraph/core-models';
import { consumeAmqp, headersToRecord, type AmqpConnectionConfig, type AmqpConsume, type AmqpConsumer, type AmqpDelivery } from './amqp-client.js';

/** Pause before reconnecting and before requeueing, so a down database is not hammered. */
const DEFAULT_RETRY_DELAY_MS = 5_000;

export interface AmqpReceiverConfig extends AmqpConnectionConfig {
  readonly queue: string;
  /** UTF-8 when absent. */
  readonly charset?: QueueCharset;
  /** Failures in a row before the receiver stops; DEFAULT_MAX_STORE_ATTEMPTS when absent. */
  readonly maxStoreAttempts?: number;
}

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
      headers: headersToRecord(delivery.headers),
      ...(delivery.messageId === undefined ? {} : { messageId: delivery.messageId }),
      ...(delivery.contentType === undefined ? {} : { contentType: delivery.contentType }),
    },
  };
}

/** One start of the source. A message that outlives a halt is settled on its own connection. */
interface Run {
  consumer: AmqpConsumer | null;
  /** False once the source stops, is halted or gives up: it takes no more messages. */
  live: boolean;
  readonly halted: AbortController;
  /** Ends once what was delivered is settled, or left to the broker. */
  queue: Promise<void>;
  /** Deliveries that are not settled yet; one, with prefetch 1. */
  inHand: number;
  readonly wakers: Set<() => void>;
}

export class AmqpReceiver implements SourceConnectorRuntime {
  private readonly config: AmqpReceiverConfig;
  private readonly consume: AmqpConsume;
  private readonly logger: ConnectorLogger;
  private readonly retryDelayMs: number;
  private dispatcher: MessageDispatcher | null = null;
  private health: SourceHealthHandler = () => undefined;
  private run: Run | null = null;
  private onFatal: SourceFatalHandler | null = null;
  /**
   * Per message id. A message without one counts under '' as failures in a row, which assumes
   * it returns before the messages behind it (true for a classic queue with prefetch 1, not
   * promised by a quorum queue). Not `x-delivery-count`: RabbitMQ 4.x does not raise it for a
   * nack with requeue.
   */
  private readonly failures = new Map<string, number>();

  constructor(config: AmqpReceiverConfig, consume?: AmqpConsume, logger?: ConnectorLogger, retryDelayMs?: number) {
    this.config = config;
    this.consume = consume ?? consumeAmqp;
    this.logger = logger ?? createConnectorLogger('AMQP');
    this.retryDelayMs = retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  setHealthHandler(handler: SourceHealthHandler): void {
    this.health = handler;
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

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) throw new Error('Dispatcher not set — call setDispatcher before start');
      this.failures.clear();
      const run: Run = { consumer: null, live: true, halted: new AbortController(), queue: Promise.resolve(), inHand: 0, wakers: new Set() };
      // Before the connect, so that a stop, halt or undeploy in the middle of it ends this one: a
      // message can come before the consumer does.
      this.run = run;
      run.consumer = await this.consume(this.config, (d) => { this.enqueue(run, d); });
      if (!run.live) {
        await this.closeConsumer(run, HALT_CLOSE_MS);
        throw new Error('The source was stopped before it had started');
      }
      void this.watch(run);
    });
  }

  /** Waits for the message in hand, however long it takes, until a halt. */
  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      const { run } = this;
      if (!run) return;
      this.endRun(run);
      if (await settleUnlessAborted(run.queue, run.halted.signal)) await this.closeConsumer(run, STOP_CLOSE_MS);
    });
  }

  /** Does not wait: the connection is kept for a message in hand, which is settled on it when it ends. */
  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      const { run } = this;
      if (!run) return;
      this.endRun(run);
      run.halted.abort();
      if (run.inHand === 0) await this.closeConsumer(run, HALT_CLOSE_MS);
      else void run.queue.then(() => this.closeConsumer(run, STOP_CLOSE_MS));
    });
  }

  private endRun(run: Run): void {
    run.live = false;
    for (const wake of [...run.wakers]) wake();
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
      if (this.run) this.endRun(this.run);
    });
  }

  private async watch(run: Run): Promise<void> {
    while (run.live) {
      try {
        if (!run.consumer) {
          run.consumer = await this.consume(this.config, (d) => { this.enqueue(run, d); });
          if (!run.live) break;
          this.logger.info({ queue: this.config.queue }, 'AMQP consumer reconnected');
        }
        this.health(null);
        const reason = await run.consumer.closed;
        if (run.live) {
          this.logger.error({ ...errorInfo(reason), queue: this.config.queue }, 'AMQP connection lost; unacknowledged messages return to the queue; reconnecting');
          this.health(null);
          this.health(reason);
        }
      } catch (err) {
        if (run.live) {
          this.logger.error({ ...errorInfo(err), queue: this.config.queue }, 'AMQP reconnect failed; retrying');
          this.health(stderr(err));
        }
      }
      // `closed` also settles when only the channel ends (a cancelled consumer,
      // a consumer_timeout); the connection is still open and must be closed.
      await this.closeConsumer(run, STOP_CLOSE_MS);
      if (run.live) await this.pause(run);
    }
    // A stop or halt during the reconnect above must not leave it open.
    await this.closeConsumer(run, STOP_CLOSE_MS);
  }

  /** The chain must never stay rejected, or every later delivery is skipped while the channel shows STARTED. */
  private enqueue(run: Run, delivery: AmqpDelivery): void {
    run.inHand += 1;
    run.queue = run.queue
      .then(() => this.handle(run, delivery))
      .catch((err: unknown) => {
        this.logger.error({ ...errorInfo(err), queue: this.config.queue, routingKey: delivery.routingKey }, 'AMQP message handling failed unexpectedly; returning it to the queue');
        this.settle({ queue: this.config.queue }, () => { delivery.nack(true); });
      })
      .finally(() => { run.inHand -= 1; });
  }

  /** A throw becomes a failed result, so the message is requeued and counts toward the cap. */
  private async dispatchDelivery(dispatcher: MessageDispatcher, delivery: AmqpDelivery, where: Readonly<Record<string, unknown>>, onStored: RawMessage['onStored']): Promise<Result<DispatchResult>> {
    return tryCatch(async () => {
      const raw = { ...toRawMessage(delivery, this.config.queue, this.config.charset), onStored };
      if (raw.sourceMap['charsetError']) {
        this.logger.warn(where, 'AMQP message body is not valid UTF-8; invalid bytes were replaced and the message is flagged (charsetError in the source map)');
      }
      const result = await dispatcher(raw);
      if (!result.ok) throw result.error;
      return result.value;
    });
  }

  private async handle(run: Run, delivery: AmqpDelivery): Promise<void> {
    const dispatcher = this.dispatcher;
    // Not acknowledged: the channel closes on stop and the broker requeues it.
    if (!dispatcher || !run.live) return;
    const where = { queue: this.config.queue, routingKey: delivery.routingKey, redelivered: delivery.redelivered };
    let rawKept = false;
    const result = await this.dispatchDelivery(dispatcher, delivery, where, ({ recoverable }) => { rawKept = recoverable; });
    if (!result.ok) {
      await this.notStored(run, delivery, result.error, where);
      return;
    }
    // A stored message also ends a run of failures on messages without an id.
    this.failures.delete(delivery.messageId ?? '');
    this.failures.delete('');
    const failure = dispatchFailure(result);
    if (run.halted.signal.aborted && !rawKept && (failure !== null || result.value.destinationFailed === true)) {
      this.logger.warn({ ...where, messageId: result.value.messageId }, 'A halt ended an AMQP message whose content the channel does not keep; it returns to the queue');
      this.settle(where, () => { delivery.nack(true); });
      return;
    }
    if (failure) {
      this.logger.error({ ...errorInfo(failure), ...where }, 'AMQP message stored with an ERROR status; rejecting it without requeue (to the dead-letter exchange, if the queue has one)');
      this.settle(where, () => { delivery.nack(false); });
      return;
    }
    this.settle(where, () => { delivery.ack(); });
  }

  private async notStored(run: Run, delivery: AmqpDelivery, cause: Error, where: Readonly<Record<string, unknown>>): Promise<void> {
    if (!run.live) {
      this.logger.warn({ ...errorInfo(cause), ...where }, 'Pipeline did not store the AMQP message while the source was stopping; it returns to the queue');
      this.settle(where, () => { delivery.nack(true); });
      return;
    }
    const key = delivery.messageId ?? '';
    const attempts = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, attempts);
    if (attempts >= (this.config.maxStoreAttempts ?? DEFAULT_MAX_STORE_ATTEMPTS)) {
      await this.giveUp(run, cause, where, attempts);
      return;
    }
    this.logger.error({ ...errorInfo(cause), ...where, attempts }, 'Pipeline did not store the AMQP message; returning it to the queue');
    await this.pause(run);
    this.settle(where, () => { delivery.nack(true); });
  }

  /** Neither acks nor rejects: closing the connection returns the message to the queue for the next start. */
  private async giveUp(run: Run, cause: Error, where: Readonly<Record<string, unknown>>, attempts: number): Promise<void> {
    this.endRun(run);
    this.logger.error({ ...errorInfo(cause), ...where, attempts }, 'AMQP source stopped: the message failed too many times in a row; it stays on the queue');
    await this.closeConsumer(run, STOP_CLOSE_MS);
    // A start while closing is a new run this report must not stop.
    if (this.run !== run) return;
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

  private async closeConsumer(run: Run, timeoutMs: number): Promise<void> {
    const { consumer } = run;
    run.consumer = null;
    if (!consumer) return;
    try {
      await consumer.close(timeoutMs);
    } catch (err) {
      this.logger.warn(errorInfo(err), 'Error closing AMQP connection');
    }
  }

  private async pause(run: Run): Promise<void> {
    await new Promise<void>((resolve) => {
      const wake = (): void => { clearTimeout(timer); run.wakers.delete(wake); resolve(); };
      const timer = setTimeout(wake, this.retryDelayMs);
      run.wakers.add(wake);
    });
  }
}
