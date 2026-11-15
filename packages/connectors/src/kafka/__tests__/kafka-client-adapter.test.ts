// ===========================================
// Kafka Client Adapter Tests (mocked @platformatic/kafka)
// ===========================================
// The adapter's contract with the client library: what it asks the library
// for (manual commits, acks=all, Buffer header names) and how it maps the
// answers. connector-queue.itest.ts runs the same code against a real broker.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const lib = vi.hoisted(() => ({
  consumerOptions: [] as unknown[],
  consumeOptions: [] as unknown[],
  consumerClosed: [] as (boolean | undefined)[],
  stream: null as (Readable & { close?: () => Promise<void> }) | null,
  consumeError: null as Error | null,
  errorDuringConsume: null as Error | null,
  consumer: null as { emit(event: string, ...args: unknown[]): boolean } | null,
  producerOptions: [] as unknown[],
  sent: [] as unknown[],
  sendError: null as Error | null,
  producerClosed: 0,
  adminOptions: [] as unknown[],
  metadataArgs: [] as unknown[],
  metadata: null as unknown,
  adminClosed: 0,
}));

vi.mock('@platformatic/kafka', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    ProduceAcks: { ALL: -1, NO_RESPONSE: 0, LEADER: 1 },
    // An EventEmitter like the real one: an 'error' nobody listens for throws.
    Consumer: class extends EventEmitter {
      constructor(options: unknown) { super(); lib.consumerOptions.push(options); lib.consumer = this; }
      async consume(options: unknown): Promise<unknown> {
        lib.consumeOptions.push(options);
        if (lib.consumeError) throw lib.consumeError;
        if (lib.errorDuringConsume) this.emit('error', lib.errorDuringConsume);
        return lib.stream;
      }
      async close(force?: boolean): Promise<void> { lib.consumerClosed.push(force); }
    },
    Producer: class {
      constructor(options: unknown) { lib.producerOptions.push(options); }
      async send(options: { messages: unknown[] }): Promise<unknown> {
        if (lib.sendError) throw lib.sendError;
        lib.sent.push(...options.messages);
        return { offsets: [{ topic: 'results', partition: 2, offset: 41n }] };
      }
      async close(): Promise<void> { lib.producerClosed += 1; }
    },
    Admin: class {
      constructor(options: unknown) { lib.adminOptions.push(options); }
      async metadata(options: unknown): Promise<unknown> {
        lib.metadataArgs.push(options);
        if (lib.metadata instanceof Error) throw lib.metadata;
        return lib.metadata;
      }
      async close(): Promise<void> { lib.adminClosed += 1; }
    },
  };
});

const { subscribeKafka, createKafkaProducer, testKafkaConnection } = await import('../kafka-client.js');

const connection = { brokers: 'k1:9092', clientId: 'galvaniflow', saslMechanism: 'NONE' as const, saslUsername: '', saslPassword: '' };

beforeEach(() => {
  lib.consumerOptions = [];
  lib.consumeOptions = [];
  lib.consumerClosed = [];
  lib.consumeError = null;
  lib.errorDuringConsume = null;
  lib.consumer = null;
  lib.producerOptions = [];
  lib.sent = [];
  lib.sendError = null;
  lib.producerClosed = 0;
  lib.adminOptions = [];
  lib.metadataArgs = [];
  lib.adminClosed = 0;
});

describe('subscribeKafka', () => {
  it('joins the group with automatic commits off and reads from the committed offset', async () => {
    lib.stream = Object.assign(Readable.from([]), { close: async () => undefined });
    await subscribeKafka({ ...connection, topic: 'adt', groupId: 'g1', startFrom: 'LATEST' });
    expect(lib.consumerOptions[0]).toMatchObject({ groupId: 'g1', autocommit: false, bootstrapBrokers: ['k1:9092'] });
    expect(lib.consumeOptions[0]).toEqual({ topics: ['adt'], mode: 'committed', fallbackMode: 'latest', autocommit: false });
  });

  it('yields records with their position and commits through the message', async () => {
    const commit = vi.fn(async () => undefined);
    const message = {
      topic: 'adt', partition: 1, offset: 7n, timestamp: 5n, key: Buffer.from('k'), value: Buffer.from('v'),
      headers: new Map([[Buffer.from('h'), Buffer.from('x')]]), commit,
    };
    lib.stream = Object.assign(Readable.from([message]), { close: async () => undefined });
    const subscription = await subscribeKafka({ ...connection, topic: 'adt', groupId: 'g1', startFrom: 'EARLIEST' });
    expect(lib.consumeOptions[0]).toMatchObject({ fallbackMode: 'earliest' });
    const records = [];
    for await (const record of subscription) records.push(record);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ topic: 'adt', partition: 1, offset: 7n, value: Buffer.from('v') });
    await records[0]?.commit();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('closes the stream, then the consumer', async () => {
    const order: string[] = [];
    lib.stream = Object.assign(Readable.from([]), { close: async () => { order.push('stream'); } });
    const subscription = await subscribeKafka({ ...connection, topic: 'adt', groupId: 'g1', startFrom: 'EARLIEST' });
    await subscription.close(true);
    expect(order).toEqual(['stream']);
    expect(lib.consumerClosed).toEqual([true]);
  });

  // The client emits 'error' when a rejoin after a failed heartbeat fails, with
  // or without a record in flight. Unheard, it became an uncaught exception.
  it('ends an idle subscription with the error when the consumer cannot rejoin its group', async () => {
    const idle = new Readable({ read(): void { /* no records */ } });
    lib.stream = Object.assign(idle, { close: async () => undefined });
    const subscription = await subscribeKafka({ ...connection, topic: 'adt', groupId: 'g1', startFrom: 'EARLIEST' });
    const reading = (async (): Promise<number> => {
      let count = 0;
      for await (const _record of subscription) count += 1;
      return count;
    })();
    lib.consumer?.emit('error', Object.assign(new Error('Rejoining the group failed.'), { errors: [new Error('COORDINATOR_NOT_AVAILABLE')] }));
    await expect(reading).rejects.toThrow('Rejoining the group failed. COORDINATOR_NOT_AVAILABLE');
    await subscription.close(true);
    expect(lib.consumerClosed).toEqual([true]);
  });

  it('ends the subscription when the consumer fails while joining', async () => {
    lib.errorDuringConsume = new Error('Rejoining the group failed.');
    lib.stream = Object.assign(new Readable({ read(): void { /* no records */ } }), { close: async () => undefined });
    const subscription = await subscribeKafka({ ...connection, topic: 'adt', groupId: 'g1', startFrom: 'EARLIEST' });
    await expect((async (): Promise<void> => { for await (const _record of subscription) { /* none */ } })()).rejects.toThrow('Rejoining the group failed.');
  });

  it('closes the consumer and rethrows when the group cannot be joined', async () => {
    lib.consumeError = new Error('GROUP_AUTHORIZATION_FAILED');
    await expect(subscribeKafka({ ...connection, topic: 'adt', groupId: 'g1', startFrom: 'EARLIEST' })).rejects.toThrow('GROUP_AUTHORIZATION_FAILED');
    expect(lib.consumerClosed).toEqual([true]);
  });
});

describe('createKafkaProducer', () => {
  it('waits for every in-sync replica and sends header names as Buffers', async () => {
    const producer = createKafkaProducer(connection);
    const written = await producer.send({ topic: 'results', key: Buffer.from('P42'), value: Buffer.from('MSH'), headers: { site: Buffer.from('north') } });
    expect(lib.producerOptions[0]).toMatchObject({ acks: -1 });
    const sent = lib.sent[0] as { key: Buffer; headers: Map<Buffer, Buffer> };
    expect(sent.key.toString()).toBe('P42');
    // The client's default serializers need Buffer header names; strings failed to encode.
    const [[name, value]] = [...sent.headers.entries()];
    expect(Buffer.isBuffer(name) && name.toString()).toBe('site');
    expect(value?.toString()).toBe('north');
    expect(written).toEqual({ topic: 'results', partition: 2, offset: '41' });
  });

  it('sends no key when there is none', async () => {
    await createKafkaProducer(connection).send({ topic: 'results', key: undefined, value: Buffer.from('MSH'), headers: {} });
    expect(lib.sent[0]).not.toHaveProperty('key');
  });

  it('puts the nested reasons of a failed send into the error', async () => {
    lib.sendError = Object.assign(new Error('Producing messages failed.'), { errors: [new Error('NOT_ENOUGH_REPLICAS')] });
    await expect(createKafkaProducer(connection).send({ topic: 't', key: undefined, value: Buffer.from('x'), headers: {} }))
      .rejects.toThrow('Producing messages failed. NOT_ENOUGH_REPLICAS');
  });

  it('closes the client', async () => {
    await createKafkaProducer(connection).close();
    expect(lib.producerClosed).toBe(1);
  });
});

describe('testKafkaConnection', () => {
  const metadata = (topics: Record<string, number>): unknown => ({
    id: 'cluster-1', brokers: new Map([[1, {}], [2, {}]]),
    topics: new Map(Object.entries(topics).map(([name, partitionsCount]) => [name, { partitionsCount }])),
  });

  it('reports the cluster, and the topic with its partitions', async () => {
    lib.metadata = metadata({ adt: 3 });
    await expect(testKafkaConnection(connection, 'adt')).resolves.toBe('Connected to Kafka cluster cluster-1: 2 broker(s), topic adt has 3 partition(s)');
    expect(lib.metadataArgs[0]).toEqual({ topics: ['adt'] });
    expect(lib.adminClosed).toBe(1);
  });

  it('reports the cluster alone when no topic is given', async () => {
    lib.metadata = metadata({});
    await expect(testKafkaConnection(connection)).resolves.toBe('Connected to Kafka cluster cluster-1: 2 broker(s)');
    expect(lib.metadataArgs[0]).toEqual({});
  });

  it('fails for a missing topic and closes the client', async () => {
    lib.metadata = metadata({});
    await expect(testKafkaConnection(connection, 'adt')).rejects.toThrow('Topic adt does not exist');
    expect(lib.adminClosed).toBe(1);
  });

  it('passes on a broker failure with its reasons', async () => {
    lib.metadata = Object.assign(new Error('Cannot connect to any broker.'), { errors: [new Error('SASL authentication failed')] });
    await expect(testKafkaConnection(connection, 'adt')).rejects.toThrow('SASL authentication failed');
    expect(lib.adminClosed).toBe(1);
  });
});
