import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { nestedTables, nestedTablesJson } from '../../__fixtures__/nested-headers.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';
import type { AmqpDelivery } from '../amqp-client.js';

class FakeChannel extends EventEmitter {
  constructor(private readonly onClose: () => void) { super(); }
  async close(): Promise<void> { this.onClose(); }
  calls: [string, ...unknown[]][] = [];
  consumer: ((msg: unknown) => void) | null = null;
  checkQueueError: Error | null = null;
  confirm: { error?: Error; returned?: boolean } = {};
  async checkQueue(q: string): Promise<unknown> {
    this.calls.push(['checkQueue', q]);
    if (this.checkQueueError) {
      // amqplib emits 'error' on the channel as well as rejecting.
      this.emit('error', this.checkQueueError);
      throw this.checkQueueError;
    }
    return { queue: q, messageCount: 4, consumerCount: 1 };
  }
  async checkExchange(e: string): Promise<unknown> { this.calls.push(['checkExchange', e]); return {}; }
  async prefetch(n: number): Promise<void> { this.calls.push(['prefetch', n]); }
  async consume(q: string, fn: (msg: unknown) => void, options: unknown): Promise<void> {
    this.calls.push(['consume', q, options]);
    this.consumer = fn;
  }
  ack(msg: unknown): void { this.calls.push(['ack', msg]); }
  nack(msg: unknown, all: boolean, requeue: boolean): void { this.calls.push(['nack', msg, all, requeue]); }
  publish(exchange: string, key: string, content: Buffer, options: { messageId: string }, cb: (err: unknown) => void): boolean {
    this.calls.push(['publish', exchange, key, content, options]);
    if (this.confirm.returned) this.emit('return', { properties: { messageId: options.messageId } });
    cb(this.confirm.error ?? null);
    return true;
  }
}

class FakeModel extends EventEmitter {
  channel = new FakeChannel(() => { this.order.push('channel'); });
  readonly order: string[] = [];
  closed = 0;
  /** The broker never answers the close. */
  hangs = false;
  socketDestroyed = false;
  readonly connection = { stream: { destroy: (): void => { this.socketDestroyed = true; } } };
  async createChannel(): Promise<FakeChannel> { return this.channel; }
  async createConfirmChannel(): Promise<FakeChannel> { return this.channel; }
  async close(): Promise<void> {
    this.closed += 1;
    this.order.push('connection');
    if (this.hangs) await new Promise(() => undefined);
    this.emit('close');
  }
}

const lib = vi.hoisted(() => ({ models: [] as unknown[], connectArgs: [] as unknown[][] }));
vi.mock('amqplib', () => ({
  connect: async (...args: unknown[]): Promise<unknown> => {
    lib.connectArgs.push(args);
    const model = new FakeModel();
    lib.models.push(model);
    return model;
  },
}));

const { consumeAmqp, createAmqpPublisher, testAmqpConnection } = await import('../amqp-client.js');
const { AmqpReceiver, toRawMessage } = await import('../amqp-receiver.js');

const config = { host: 'rabbit', port: 5672, vhost: '/', username: 'u', password: 'p' };
const lastModel = (): FakeModel => lib.models.at(-1) as FakeModel;

beforeEach(() => {
  lib.models = [];
  lib.connectArgs = [];
});

describe('consumeAmqp', () => {
  it('checks the queue, takes one message at a time and acknowledges manually', async () => {
    await consumeAmqp({ ...config, queue: 'adt' }, () => undefined);
    expect(lastModel().channel.calls).toEqual([
      ['checkQueue', 'adt'],
      ['prefetch', 1],
      ['consume', 'adt', { noAck: false }],
    ]);
  });

  it('hands over deliveries whose ack and nack reach the channel', async () => {
    const seen: AmqpDelivery[] = [];
    await consumeAmqp({ ...config, queue: 'adt' }, (d) => { seen.push(d); });
    const msg = {
      content: Buffer.from('MSH'), fields: { exchange: 'hl7', routingKey: 'adt.a01', redelivered: true },
      properties: { headers: { site: Buffer.from('north') }, messageId: 'm-1', contentType: 'text/plain' },
    };
    lastModel().channel.consumer?.(msg);
    const delivery = seen[0];
    if (!delivery) throw new Error('no delivery');
    expect(delivery).toMatchObject({ routingKey: 'adt.a01', messageId: 'm-1' });
    expect(toRawMessage(delivery, 'adt').sourceMap['headers']).toEqual({ site: 'north' });
    delivery.ack();
    delivery.nack(true);
    expect(lastModel().channel.calls.slice(-2)).toEqual([['ack', msg], ['nack', msg, false, true]]);
  });

  it('takes a message whose headers are nested 5,000 deep, and the message behind it', async () => {
    const log = makeMockLogger();
    const offered: { content: string; headers: unknown }[] = [];
    const receiver = new AmqpReceiver({ ...config, queue: 'adt' }, consumeAmqp, log.logger, 5);
    receiver.setDispatcher(async (raw) => {
      offered.push({ content: raw.content, headers: raw.sourceMap['headers'] });
      return { ok: true, value: { messageId: offered.length }, error: null };
    });
    await receiver.onStart();
    const message = (body: string, headers: Record<string, unknown>): unknown => ({
      content: Buffer.from(body), fields: { exchange: 'hl7', routingKey: 'adt.a01', redelivered: false }, properties: { headers },
    });

    // amqplib closes the channel when its consume callback throws.
    const channel = lastModel().channel;
    expect(() => channel.consumer?.(message('deep', { site: 'north', x: nestedTables(5_000) }))).not.toThrow();
    channel.consumer?.(message('behind', { site: 'south' }));

    await vi.waitFor(() => { expect(channel.calls.filter(([name]) => name === 'ack')).toHaveLength(2); });
    expect(offered).toEqual([
      { content: 'deep', headers: { site: 'north', x: nestedTablesJson(5_000) } },
      { content: 'behind', headers: { site: 'south' } },
    ]);
    expect(log.errors).toEqual([]);
    await receiver.onStop();
  });

  it('settles closed when the broker cancels the consumer', async () => {
    const consumer = await consumeAmqp({ ...config, queue: 'adt' }, () => undefined);
    lastModel().channel.consumer?.(null);
    expect((await consumer.closed).message).toContain('cancelled the consumer');
  });

  it('settles closed with the connection error when the connection drops', async () => {
    const consumer = await consumeAmqp({ ...config, queue: 'adt' }, () => undefined);
    lastModel().emit('error', new Error('ECONNRESET'));
    lastModel().emit('close');
    expect((await consumer.closed).message).toBe('ECONNRESET');
  });

  it('closes the connection and rethrows when the queue does not exist', async () => {
    const attempt = consumeAmqp({ ...config, queue: 'missing' }, () => undefined);
    // The channel is created inside; make its check fail before awaiting.
    lastModel().channel.checkQueueError = new Error("NOT_FOUND - no queue 'missing'");
    await expect(attempt).rejects.toThrow('NOT_FOUND');
    expect(lastModel().closed).toBe(1);
  });
});

describe('createAmqpPublisher', () => {
  const outbound = { exchange: 'hl7', routingKey: 'adt', content: Buffer.from('MSH'), headers: { a: 'b' }, contentType: 'text/plain', messageId: 'c1:7:1' };

  it('publishes persistent, mandatory messages and resolves on the confirm', async () => {
    const publisher = await createAmqpPublisher(config);
    await publisher.publish(outbound);
    const [, exchange, key, , options] = lastModel().channel.calls.at(-1) ?? [];
    expect([exchange, key]).toEqual(['hl7', 'adt']);
    expect(options).toMatchObject({ persistent: true, mandatory: true, messageId: 'c1:7:1', headers: { a: 'b' }, contentType: 'text/plain' });
  });

  it('fails a message the broker returned as unroutable', async () => {
    const publisher = await createAmqpPublisher(config);
    lastModel().channel.confirm = { returned: true };
    await expect(publisher.publish(outbound)).rejects.toThrow('the broker returned the message');
  });

  it('fails a message the broker nacked', async () => {
    const publisher = await createAmqpPublisher(config);
    lastModel().channel.confirm = { error: new Error('nacked') };
    await expect(publisher.publish(outbound)).rejects.toThrow('nacked');
  });

  it('reports the connection closed after the broker drops it, and after close', async () => {
    const publisher = await createAmqpPublisher(config);
    expect(publisher.isOpen).toBe(true);
    lastModel().channel.emit('close');
    expect(publisher.isOpen).toBe(false);
    await publisher.close(1_000);
    expect(lastModel().closed).toBe(1);
  });
});

describe('testAmqpConnection', () => {
  it('describes the queue it found', async () => {
    await expect(testAmqpConnection(config, { queue: 'adt' })).resolves.toBe('Connected to rabbit:5672: queue adt has 4 message(s) and 1 consumer(s)');
    expect(lastModel().closed).toBe(1);
  });

  it('checks a named exchange, and needs no check for the default one', async () => {
    await expect(testAmqpConnection({ ...config, vhost: '/clinical' }, { exchange: 'hl7' })).resolves.toBe('Connected to rabbit:5672 vhost /clinical: exchange hl7 exists');
    expect(lastModel().channel.calls).toEqual([['checkExchange', 'hl7']]);
    await expect(testAmqpConnection(config, { exchange: '' })).resolves.toContain('exchange (default) exists');
    expect(lastModel().channel.calls).toEqual([]);
  });

  it('fails for a missing queue without an unhandled channel error, and closes', async () => {
    const attempt = testAmqpConnection(config, { queue: 'missing' });
    lastModel().channel.checkQueueError = new Error("NOT_FOUND - no queue 'missing'");
    // An 'error' emitted with no listener would throw here instead of rejecting.
    await expect(attempt).rejects.toThrow('NOT_FOUND');
    expect(lastModel().closed).toBe(1);
  });
});

describe('a close that the broker never answers (#413)', () => {
  it.each([
    ['consumer', (): Promise<{ close(timeoutMs: number): Promise<void> }> => consumeAmqp({ ...config, queue: 'adt' }, () => undefined)],
    ['publisher', (): Promise<{ close(timeoutMs: number): Promise<void> }> => createAmqpPublisher(config)],
  ])('ends in time for a %s, and the socket goes', async (_what, open) => {
    const opened = await open();
    lastModel().hangs = true;
    vi.useFakeTimers();
    try {
      const closing = opened.close(2_000);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(lastModel().socketDestroyed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await closing;
    } finally {
      vi.useRealTimers();
    }
    expect(lastModel().socketDestroyed).toBe(true);
  });

  // The broker would return the message acknowledged last, and deliver it again.
  it('closes a consumer\'s channel before its connection, whose close overtakes an acknowledgement', async () => {
    const consumer = await consumeAmqp({ ...config, queue: 'adt' }, () => undefined);
    await consumer.close(2_000);
    expect(lastModel().order).toEqual(['channel', 'connection']);
    expect(lastModel().socketDestroyed).toBe(false);
  });
});
