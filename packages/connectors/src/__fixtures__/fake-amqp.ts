// ===========================================
// Fake AMQP queue for unit tests
// ===========================================
// A queue with prefetch 1: one message is out at a time, an ack removes it, a
// nack with requeue puts it back at the head, a nack without requeue moves it
// to `deadLettered`. Losing the connection (`disconnect()`) returns the
// unacknowledged message to the head, marked redelivered, as RabbitMQ does.

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
  /** Connect attempts left to fail. */
  failConnects = 0;
  /** Put a nacked-with-requeue message at the tail, as a quorum queue may, instead of the head. */
  requeueAtTail = false;
  private outstanding: QueuedMessage | null = null;
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
    this.connection = new FakeConsumer(this, onDelivery);
    this.consumers.push(this.connection);
    queueMicrotask(() => { this.deliverNext(); });
    return this.connection;
  };

  /** Drop the connection: the message out for processing goes back, redelivered. */
  disconnect(): void {
    const connection = this.connection;
    if (!connection) return;
    this.connection = null;
    this.returnOutstanding();
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
    this.connection = null;
    this.returnOutstanding();
    connection.lose(new Error('Consumer cancelled by the broker'), { connectionOpen: true });
  }

  get connected(): boolean {
    return this.connection !== null;
  }

  /** Connections opened and not yet closed by the client, or lost. */
  get openConnections(): number {
    return this.consumers.filter((c) => c.connectionOpen).length;
  }

  /** Called by a consumer closing its connection. */
  closed(connection: FakeConsumer): void {
    if (this.connection !== connection) return;
    this.connection = null;
    this.returnOutstanding();
  }

  private returnOutstanding(): void {
    if (!this.outstanding) return;
    this.outstanding.redelivered = true;
    this.messages.unshift(this.outstanding);
    this.outstanding = null;
  }

  private deliverNext(): void {
    const connection = this.connection;
    if (!connection || this.outstanding) return;
    const next = this.messages.shift();
    if (!next) return;
    this.outstanding = next;
    const settle = (action: () => void): void => {
      if (this.connection !== connection || this.outstanding !== next) throw new Error('Channel closed');
      this.outstanding = null;
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

  async close(): Promise<void> {
    this.connectionOpen = false;
    this.queue.closed(this);
    this.settle(new Error('closed by client'));
  }
}

/** A publisher that records messages, or fails while `failPublishes` > 0 (losing its connection if `dropOnFail`). */
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
