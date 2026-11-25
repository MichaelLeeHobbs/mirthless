// Prefetch 1, for each connection. Losing the connection returns the unacknowledged message to the head, marked
// redelivered, as RabbitMQ does.

import type { AmqpConsume, AmqpConsumer, AmqpDelivery, AmqpOutbound, AmqpPublisher } from '../amqp/amqp-client.js';

interface QueuedMessage {
  readonly body: string;
  readonly headers: Readonly<Record<string, unknown>>;
  redelivered: boolean;
}

export class FakeAmqpQueue {
  readonly messages: QueuedMessage[] = [];
  readonly acked: string[] = [];
  readonly deadLettered: string[] = [];
  connectCount = 0;
  failConnects = 0;
  /** Put a nacked-with-requeue message at the tail, as a quorum queue may, instead of the head. */
  requeueAtTail = false;
  /** The broker never answers a close. */
  hangCloses = false;
  /** A connect waits for it. */
  connecting: Promise<void> = Promise.resolve();
  /** Unacknowledged, by the connection each was delivered on. */
  private readonly outstanding = new Map<FakeConsumer, QueuedMessage>();
  /** The one new messages go to. */
  private connection: FakeConsumer | null = null;
  private readonly consumers: FakeConsumer[] = [];

  publish(body: string, headers: Record<string, unknown> = {}): void {
    this.messages.push({ body, headers, redelivered: false });
    this.deliverNext();
  }

  readonly consume: AmqpConsume = async (_options, onDelivery) => {
    this.connectCount += 1;
    if (this.failConnects > 0) {
      this.failConnects -= 1;
      throw new Error('ECONNREFUSED broker down');
    }
    await this.connecting;
    this.connection = new FakeConsumer(this, onDelivery);
    this.consumers.push(this.connection);
    // With the answer to consume, so before the caller has the consumer.
    this.deliverNext();
    return this.connection;
  };

  disconnect(): void {
    const connection = this.connection;
    if (!connection) return;
    this.closed(connection);
    connection.lose(new Error('ECONNRESET connection to broker lost'));
  }

  /**
   * The broker cancels the consumer (the queue was deleted) or closes only its
   * channel (a consumer_timeout): `closed` settles, but the connection stays
   * open until the client closes it.
   */
  cancel(): void {
    const connection = this.connection;
    if (!connection) return;
    this.closed(connection);
    connection.lose(new Error('Consumer cancelled by the broker'), { connectionOpen: true });
  }

  get connected(): boolean {
    return this.connection !== null;
  }

  get openConnections(): number {
    return this.consumers.filter((c) => c.connectionOpen).length;
  }

  /** Called by a consumer closing its connection. */
  closed(connection: FakeConsumer): void {
    if (this.connection === connection) this.connection = null;
    const returned = this.outstanding.get(connection);
    this.outstanding.delete(connection);
    if (!returned) return;
    returned.redelivered = true;
    this.messages.unshift(returned);
    queueMicrotask(() => { this.deliverNext(); });
  }

  private deliverNext(): void {
    const connection = this.connection;
    if (!connection || this.outstanding.has(connection)) return;
    const next = this.messages.shift();
    if (!next) return;
    this.outstanding.set(connection, next);
    const settle = (action: () => void): void => {
      if (this.outstanding.get(connection) !== next) throw new Error('Channel closed');
      this.outstanding.delete(connection);
      action();
      queueMicrotask(() => { this.deliverNext(); });
    };
    const delivery: AmqpDelivery = {
      content: Buffer.from(next.body),
      exchange: 'hl7',
      routingKey: 'adt.a01',
      redelivered: next.redelivered,
      headers: next.headers,
      messageId: undefined,
      contentType: 'text/plain',
      ack: () => { settle(() => { this.acked.push(next.body); }); },
      nack: (requeue) => {
        settle(() => {
          if (requeue) {
            next.redelivered = true;
            if (this.requeueAtTail) this.messages.push(next);
            else this.messages.unshift(next);
          } else {
            this.deadLettered.push(next.body);
          }
        });
      },
    };
    connection.deliver(delivery);
  }
}

class FakeConsumer implements AmqpConsumer {
  readonly closed: Promise<Error>;
  connectionOpen = true;
  private settle: (err: Error) => void = () => undefined;

  constructor(private readonly queue: FakeAmqpQueue, private readonly onDelivery: (d: AmqpDelivery) => void) {
    this.closed = new Promise((resolve) => { this.settle = resolve; });
  }

  deliver(delivery: AmqpDelivery): void {
    this.onDelivery(delivery);
  }

  lose(error: Error, { connectionOpen = false } = {}): void {
    this.connectionOpen = connectionOpen;
    this.settle(error);
  }

  async close(timeoutMs: number): Promise<void> {
    if (this.queue.hangCloses) await new Promise((resolve) => { setTimeout(resolve, timeoutMs); });
    this.connectionOpen = false;
    this.queue.closed(this);
    this.settle(new Error('closed by client'));
  }
}

export class FakeAmqpPublisher implements AmqpPublisher {
  readonly published: AmqpOutbound[] = [];
  failPublishes = 0;
  dropOnFail = false;
  isOpen = true;
  closed = false;

  async publish(message: AmqpOutbound): Promise<void> {
    if (this.failPublishes > 0) {
      this.failPublishes -= 1;
      if (this.dropOnFail) this.isOpen = false;
      throw new Error('No queue is bound to exchange "hl7" with routing key "nowhere"; the broker returned the message');
    }
    this.published.push(message);
  }

  async close(): Promise<void> {
    this.isOpen = false;
    this.closed = true;
  }
}
