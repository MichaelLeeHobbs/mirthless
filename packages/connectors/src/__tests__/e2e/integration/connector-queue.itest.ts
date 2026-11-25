import * as net from 'node:net';
import { it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Admin } from '@platformatic/kafka';
import { connect as amqpConnect, type ChannelModel } from 'amqplib';
import {
  KafkaReceiver,
  KafkaDispatcher,
  AmqpReceiver,
  AmqpDispatcher,
  testKafkaConnection,
  testAmqpConnection,
  type KafkaConnectionConfig,
  type AmqpConnectionConfig,
} from '../../../index.js';
import { createKafkaProducer, subscribeKafka } from '../../../kafka/kafka-client.js';
import {
  deployChannel,
  teardownAll,
  createInMemoryStore,
  CaptureDestination,
  type DeployedChannel,
  type InMemoryStore,
} from '../support/e2e-harness.js';
import { mllpSource, sendMllp } from '../support/tcp-helpers.js';
import { nestedTables, nestedTablesJson } from '../../../__fixtures__/nested-headers.js';
import { describeKafka, requireKafka, describeAmqp, requireAmqp, describeAmqpTls, requireAmqpTls } from './gates.js';
import { freePort } from '../../../__fixtures__/free-port.js';

const RUN = randomUUID().slice(0, 8);
const WAIT = { timeout: 30_000, interval: 100 };
const TEST_TIMEOUT = 60_000;
/** For a broker that has just started, on a loaded machine. */
const BROKER_READY = { timeout: 90_000, interval: 500 };
/** Short pause before rejoining or requeueing, so the suite is quick. */
const RETRY_MS = 200;

let deployed: DeployedChannel[] = [];
afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
});

function storeFailingFirst(failures: number): InMemoryStore {
  const store = createInMemoryStore();
  let left = failures;
  return {
    ...store,
    createMessage: async (...args) => {
      if (left > 0) {
        left -= 1;
        return { ok: false, value: null, error: new Error('database unavailable') } as never;
      }
      return store.createMessage(...args);
    },
  };
}

/** A sink that holds its first message until it is let go. */
function heldSink(): { readonly sink: CaptureDestination; readonly reached: Promise<void>; readonly letGo: () => void } {
  let reach = (): void => undefined;
  let letGo = (): void => undefined;
  const reached = new Promise<void>((resolve) => { reach = resolve; });
  const held = new Promise<void>((resolve) => { letGo = resolve; });
  const sink = new CaptureDestination();
  const send = sink.send.bind(sink);
  vi.spyOn(sink, 'send').mockImplementation(async (message, signal) => {
    const sent = await send(message, signal);
    reach();
    await held;
    return sent;
  });
  return { sink, reached, letGo: () => { letGo(); } };
}

interface Relay {
  readonly port: number;
  /** From now on neither side hears from the other, as of a partner whose machine hangs. */
  freeze(): void;
  /** That have not closed, or ended their side. */
  openClients(): number;
  close(): void;
}

async function startRelay(target: { readonly host: string; readonly port: number }): Promise<Relay> {
  const clients = new Set<net.Socket>();
  const partners = new Set<net.Socket>();
  let frozen = false;
  const server = net.createServer({ allowHalfOpen: true }, (client) => {
    const partner = net.connect(target.port, target.host);
    clients.add(client);
    partners.add(partner);
    client.on('close', () => { clients.delete(client); });
    client.on('error', () => undefined);
    partner.on('error', () => undefined);
    client.on('data', (data) => { if (!frozen) partner.write(data); });
    partner.on('data', (data) => { if (!frozen) client.write(data); });
    client.on('end', () => {
      clients.delete(client);
      if (!frozen) partner.end();
    });
    partner.on('close', () => { if (!frozen) client.destroy(); });
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  return {
    port: (server.address() as net.AddressInfo).port,
    freeze: () => { frozen = true; },
    openClients: () => clients.size,
    close: () => {
      for (const socket of [...clients, ...partners]) socket.destroy();
      server.close();
    },
  };
}

const ECHO_SOURCE_MAP = `return JSON.stringify({
  body: String(msg),
  topic: $s('topic'), key: $s('key'), headers: $s('headers'),
  routingKey: $s('routingKey'), redelivered: $s('redelivered'),
});`;

const parsed = (sink: CaptureDestination, i = 0): Record<string, unknown> =>
  JSON.parse(sink.received[i]?.content ?? '{}') as Record<string, unknown>;

describeKafka('Kafka connectors (real broker)', () => {
  const topics = {
    cascade: `e2e-north-${RUN}`,
    redelivery: `e2e-redelivery-${RUN}`,
    halted: `e2e-halted-${RUN}`,
    sasl: `e2e-sasl-${RUN}`,
  };
  const groups = { cascade: `g-cascade-${RUN}`, redelivery: `g-redelivery-${RUN}`, halted: `g-halted-${RUN}`, sasl: `g-sasl-${RUN}` };

  const connection = (): KafkaConnectionConfig => ({
    brokers: requireKafka().brokers, clientId: 'galvanigraph-e2e', saslMechanism: 'NONE', saslUsername: '', saslPassword: '',
  });

  beforeAll(async () => {
    const admin = new Admin({ clientId: 'galvanigraph-e2e-admin', bootstrapBrokers: [requireKafka().brokers] });
    try {
      await admin.createTopics({ topics: Object.values(topics), partitions: 1, replicas: 1 });
    } finally {
      await admin.close();
    }
    // A new broker creates its offsets topic on the first join, and refuses to coordinate a group
    // until that group's partition of it is loaded. A start gives up after four tries, a second apart.
    for (const name of ['cascade', 'redelivery', 'halted', 'sasl'] as const) {
      await vi.waitFor(async () => {
        const member = await subscribeKafka({ ...connection(), topic: topics[name], groupId: groups[name], startFrom: 'EARLIEST' });
        await member.close(false);
      }, BROKER_READY);
    }
  }, BROKER_READY.timeout + TEST_TIMEOUT);

  it('carries a message from a Kafka destination to a Kafka source, with topic, key and headers filled per message', async () => {
    const sink = new CaptureDestination();
    const consumer = await deployChannel({
      channelId: '00000000-0000-0000-0000-kafkae2e000b',
      dataType: 'RAW',
      source: new KafkaReceiver({ ...connection(), topic: topics.cascade, groupId: groups.cascade, startFrom: 'EARLIEST' }, undefined, undefined, RETRY_MS),
      transformer: ECHO_SOURCE_MAP,
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });
    const port = await freePort();
    const producer = await deployChannel({
      channelId: '00000000-0000-0000-0000-kafkae2e000a',
      dataType: 'RAW',
      source: mllpSource(port, { maxConnections: 5 }),
      transformer: "$c('site', 'north'); $c('patientId', 'P42'); return msg;",
      destinations: [{
        metaDataId: 1,
        name: 'Kafka Out',
        connector: new KafkaDispatcher({
          ...connection(),
          topic: `e2e-\${site}-${RUN}`,
          messageKey: '${patientId}',
          headers: { source: 'galvanigraph', patient: '${patientId}' },
        }),
      }],
    });
    deployed.push(producer, consumer);

    await sendMllp(port, 'MSH|^~\\&|KAFKA');

    // Headers matter here: a record with headers once failed to encode (string header names).
    await vi.waitFor(() => { expect(sink.received).toHaveLength(1); }, WAIT);
    expect(parsed(sink)).toMatchObject({
      body: 'MSH|^~\\&|KAFKA',
      topic: topics.cascade,
      key: 'P42',
      headers: { source: 'galvanigraph', patient: 'P42' },
    });
  }, TEST_TIMEOUT);

  const produce = async (topic: string, value: string): Promise<void> => {
    const p = createKafkaProducer(connection());
    try {
      await p.send({ topic, key: undefined, value: Buffer.from(value), headers: {} });
    } finally {
      await p.close();
    }
  };

  it('does not read a record again that was recorded when the channel was halted (#413)', async () => {
    const { sink, reached, letGo } = heldSink();
    const deploy = (channelId: string, connector: CaptureDestination): Promise<DeployedChannel> => deployChannel({
      channelId,
      dataType: 'RAW',
      source: new KafkaReceiver({ ...connection(), topic: topics.halted, groupId: groups.halted, startFrom: 'EARLIEST' }, undefined, undefined, RETRY_MS),
      destinations: [{ metaDataId: 1, name: 'sink', connector }],
    });
    const channel = await deploy('00000000-0000-0000-0000-kafkae2e0010', sink);
    deployed.push(channel);
    await produce(topics.halted, 'recorded');
    await reached;

    expect((await channel.runtime.halt()).ok).toBe(true);
    letGo();
    // Which waits for the record the halt left in hand.
    await channel.teardown();
    deployed = [];
    const sink2 = new CaptureDestination();
    deployed.push(await deploy('00000000-0000-0000-0000-kafkae2e0011', sink2));
    await produce(topics.halted, 'next');
    await vi.waitFor(() => { expect(sink2.lastContent()).toBe('next'); }, WAIT);

    expect(sink.received.map((m) => m.content)).toEqual(['recorded']);
    expect(sink2.received.map((m) => m.content)).toEqual(['next']);
  }, TEST_TIMEOUT);

  it('reads a record again when the pipeline could not store it, and commits it once stored', async () => {
    const send = (value: string): Promise<void> => produce(topics.redelivery, value);
    const group = groups.redelivery;
    const sink = new CaptureDestination();
    const store = storeFailingFirst(1);
    const channel = await deployChannel({
      channelId: '00000000-0000-0000-0000-kafkae2e000c',
      dataType: 'RAW',
      store,
      source: new KafkaReceiver({ ...connection(), topic: topics.redelivery, groupId: group, startFrom: 'EARLIEST' }, undefined, undefined, RETRY_MS),
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });
    deployed.push(channel);

    await send('first');
    await vi.waitFor(() => { expect(sink.received.map((m) => m.content)).toEqual(['first']); }, WAIT);
    expect(store.messageCount()).toBe(1);

    // A new member of the same group starts after the committed offset: it gets only what is new.
    await channel.teardown();
    deployed = [];
    const sink2 = new CaptureDestination();
    deployed.push(await deployChannel({
      channelId: '00000000-0000-0000-0000-kafkae2e000d',
      dataType: 'RAW',
      source: new KafkaReceiver({ ...connection(), topic: topics.redelivery, groupId: group, startFrom: 'EARLIEST' }, undefined, undefined, RETRY_MS),
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink2 }],
    }));
    await send('second');
    await vi.waitFor(() => { expect(sink2.received.map((m) => m.content)).toEqual(['second']); }, WAIT);
  }, TEST_TIMEOUT);

  it('publishes and consumes over SASL/PLAIN, and refuses a wrong password', async () => {
    const cfg = requireKafka();
    const sasl: KafkaConnectionConfig = {
      brokers: cfg.saslBrokers, clientId: 'galvanigraph-e2e', saslMechanism: 'PLAIN', saslUsername: cfg.username, saslPassword: cfg.password,
    };
    const sink = new CaptureDestination();
    deployed.push(await deployChannel({
      channelId: '00000000-0000-0000-0000-kafkae2e000e',
      dataType: 'RAW',
      source: new KafkaReceiver({ ...sasl, topic: topics.sasl, groupId: groups.sasl, startFrom: 'EARLIEST' }, undefined, undefined, RETRY_MS),
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    }));
    const dispatcher = new KafkaDispatcher({ ...sasl, topic: topics.sasl, messageKey: '', headers: {} });
    await dispatcher.onStart();
    try {
      const sent = await dispatcher.send(
        { channelId: 'c', messageId: 1, metaDataId: 1, content: 'over sasl', dataType: 'RAW' },
        AbortSignal.timeout(30_000),
      );
      expect(sent.ok && sent.value.status).toBe('SENT');
    } finally {
      await dispatcher.onStop();
    }
    await vi.waitFor(() => { expect(sink.lastContent()).toBe('over sasl'); }, WAIT);

    await expect(testKafkaConnection({ ...sasl, saslPassword: 'wrong' }, topics.sasl)).rejects.toThrow();
  }, TEST_TIMEOUT);

  it('connection test finds an existing topic and reports a missing one', async () => {
    await expect(testKafkaConnection(connection(), topics.cascade)).resolves.toContain('1 partition(s)');
    await expect(testKafkaConnection(connection(), `e2e-missing-${RUN}`)).rejects.toThrow();
  }, TEST_TIMEOUT);
});

describeAmqp('AMQP connectors (real RabbitMQ)', () => {
  const names = {
    exchange: `e2e-hl7-${RUN}`,
    queue: `e2e-adt-${RUN}`,
    deadExchange: `e2e-dlx-${RUN}`,
    deadQueue: `e2e-dead-${RUN}`,
    quorum: `e2e-quorum-${RUN}`,
    dropped: `e2e-dropped-${RUN}`,
    halted: `e2e-halted-${RUN}`,
  };
  let admin: ChannelModel;

  const connection = (): AmqpConnectionConfig => {
    const cfg = requireAmqp();
    return { host: cfg.host, port: cfg.port, vhost: '/', username: cfg.username, password: cfg.password };
  };

  // Topology is the administrator's job, not the connector's. Queues are durable because
  // RabbitMQ 4.3+ refuses transient non-exclusive ones (`transient_nonexcl_queues`).
  beforeAll(async () => {
    const cfg = requireAmqp();
    admin = await amqpConnect({ hostname: cfg.host, port: cfg.port, username: cfg.username, password: cfg.password });
    const ch = await admin.createChannel();
    await ch.assertExchange(names.exchange, 'topic', { durable: false, autoDelete: false });
    await ch.assertExchange(names.deadExchange, 'fanout', { durable: false });
    await ch.assertQueue(names.deadQueue, { durable: true });
    await ch.bindQueue(names.deadQueue, names.deadExchange, '');
    await ch.assertQueue(names.queue, { durable: true, deadLetterExchange: names.deadExchange });
    await ch.bindQueue(names.queue, names.exchange, 'adt.#');
    await ch.assertQueue(names.quorum, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
    await ch.assertQueue(names.dropped, { durable: true });
    await ch.assertQueue(names.halted, { durable: true });
    await ch.close();
  });

  afterAll(async () => {
    const ch = await admin.createChannel();
    for (const q of [names.queue, names.deadQueue, names.quorum, names.dropped, names.halted]) await ch.deleteQueue(q);
    for (const e of [names.exchange, names.deadExchange]) await ch.deleteExchange(e);
    await admin.close();
  });

  const publishDirect = async (body: string, headers: Record<string, unknown> = { site: 'north' }): Promise<void> => {
    const ch = await admin.createConfirmChannel();
    ch.publish(names.exchange, 'adt.a01', Buffer.from(body), { headers });
    await ch.waitForConfirms();
    await ch.close();
  };

  const source = (): AmqpReceiver => new AmqpReceiver({ ...connection(), queue: names.queue }, undefined, undefined, RETRY_MS);

  it('carries a message from an AMQP destination to an AMQP source, with routing key and headers filled per message', async () => {
    const sink = new CaptureDestination();
    const consumer = await deployChannel({
      channelId: '00000000-0000-0000-0000-amqpe2e0000b',
      dataType: 'RAW',
      source: source(),
      transformer: ECHO_SOURCE_MAP,
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });
    const port = await freePort();
    const producer = await deployChannel({
      channelId: '00000000-0000-0000-0000-amqpe2e0000a',
      dataType: 'RAW',
      source: mllpSource(port, { maxConnections: 5 }),
      transformer: "$c('event', 'a01'); $c('patientId', 'P42'); return msg;",
      destinations: [{
        metaDataId: 1,
        name: 'AMQP Out',
        connector: new AmqpDispatcher({
          ...connection(),
          exchange: names.exchange,
          routingKey: 'adt.${event}',
          headers: { patient: '${patientId}' },
          contentType: 'application/hl7-v2',
        }),
      }],
    });
    deployed.push(producer, consumer);

    await sendMllp(port, 'MSH|^~\\&|AMQP');

    await vi.waitFor(() => { expect(sink.received).toHaveLength(1); }, WAIT);
    expect(parsed(sink)).toMatchObject({
      body: 'MSH|^~\\&|AMQP',
      routingKey: 'adt.a01',
      headers: { patient: 'P42' },
      redelivered: false,
    });
  }, TEST_TIMEOUT);

  it('does not deliver a message again that was recorded when the channel was halted (#413)', async () => {
    const { sink, reached, letGo } = heldSink();
    const deploy = (channelId: string, connector: CaptureDestination): Promise<DeployedChannel> => deployChannel({
      channelId,
      dataType: 'RAW',
      source: new AmqpReceiver({ ...connection(), queue: names.halted }, undefined, undefined, RETRY_MS),
      destinations: [{ metaDataId: 1, name: 'sink', connector }],
    });
    const publish = async (body: string): Promise<void> => {
      const ch = await admin.createConfirmChannel();
      ch.sendToQueue(names.halted, Buffer.from(body));
      await ch.waitForConfirms();
      await ch.close();
    };
    const channel = await deploy('00000000-0000-0000-0000-amqpe2e00020', sink);
    deployed.push(channel);
    await publish('recorded');
    await reached;

    expect((await channel.runtime.halt()).ok).toBe(true);
    const sink2 = new CaptureDestination();
    deployed.push(await deploy('00000000-0000-0000-0000-amqpe2e00021', sink2));
    await publish('next');
    await vi.waitFor(() => { expect(sink2.lastContent()).toBe('next'); }, WAIT);
    letGo();

    // The old consumer is gone, and a message it had returned would be ahead of the last one.
    const ch = await admin.createChannel();
    try {
      await vi.waitFor(async () => { expect((await ch.checkQueue(names.halted)).consumerCount).toBe(1); }, WAIT);
    } finally {
      await ch.close();
    }
    await publish('last');
    await vi.waitFor(() => { expect(sink2.lastContent()).toBe('last'); }, WAIT);
    expect(sink.received.map((m) => m.content)).toEqual(['recorded']);
    expect(sink2.received.map((m) => m.content)).toEqual(['next', 'last']);
  }, TEST_TIMEOUT);

  it('a halt ends in time and closes the connection when the broker stops answering (#413)', async () => {
    const relay = await startRelay(connection());
    try {
      const dispatcher = new AmqpDispatcher({ ...connection(), host: '127.0.0.1', port: relay.port, exchange: '', routingKey: names.halted, headers: {}, contentType: 'text/plain' });
      const receiver = new AmqpReceiver({ ...connection(), host: '127.0.0.1', port: relay.port, queue: names.halted }, undefined, undefined, RETRY_MS);
      receiver.setDispatcher(async () => ({ ok: true as const, value: { messageId: 1 }, error: null }));
      await dispatcher.onStart();
      const sent = await dispatcher.send({ channelId: 'c', messageId: 1, metaDataId: 1, content: 'x', dataType: 'RAW' }, AbortSignal.timeout(30_000));
      expect(sent.ok && sent.value.status).toBe('SENT');
      expect((await receiver.onStart()).ok).toBe(true);
      expect(relay.openClients()).toBe(2);
      relay.freeze();

      const before = Date.now();
      const halted = await Promise.all([dispatcher.onHalt(), receiver.onHalt()]);

      expect(halted.map((r) => r.ok)).toEqual([true, true]);
      // 2 seconds, and what a loaded machine adds.
      expect(Date.now() - before).toBeLessThan(8_000);
      await vi.waitFor(() => { expect(relay.openClients()).toBe(0); }, WAIT);
    } finally {
      relay.close();
    }
  }, TEST_TIMEOUT);

  it('fails a publish no queue would receive instead of dropping it', async () => {
    const dispatcher = new AmqpDispatcher({ ...connection(), exchange: names.exchange, routingKey: 'orm.o01', headers: {}, contentType: 'text/plain' });
    await dispatcher.onStart();
    try {
      const result = await dispatcher.send({ channelId: 'c', messageId: 1, metaDataId: 1, content: 'x', dataType: 'RAW' }, AbortSignal.timeout(30_000));
      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain('returned the message');
    } finally {
      await dispatcher.onStop();
    }
  }, TEST_TIMEOUT);

  it('returns a message the pipeline could not store to the queue, and it is delivered again', async () => {
    const sink = new CaptureDestination();
    const store = storeFailingFirst(1);
    deployed.push(await deployChannel({
      channelId: '00000000-0000-0000-0000-amqpe2e0000c',
      dataType: 'RAW',
      store,
      source: source(),
      transformer: ECHO_SOURCE_MAP,
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    }));

    await publishDirect('retry me');

    await vi.waitFor(() => { expect(sink.received).toHaveLength(1); }, WAIT);
    expect(parsed(sink)).toMatchObject({ body: 'retry me', redelivered: true, headers: { site: 'north' } });
    expect(store.messageCount()).toBe(1);
  }, TEST_TIMEOUT);

  it('returns a message the pipeline could not store to a quorum queue, and it is delivered again', async () => {
    const sink = new CaptureDestination();
    const store = storeFailingFirst(2);
    deployed.push(await deployChannel({
      channelId: '00000000-0000-0000-0000-amqpe2e0000f',
      dataType: 'RAW',
      store,
      source: new AmqpReceiver({ ...connection(), queue: names.quorum }, undefined, undefined, RETRY_MS),
      transformer: ECHO_SOURCE_MAP,
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    }));

    const ch = await admin.createConfirmChannel();
    ch.sendToQueue(names.quorum, Buffer.from('quorum retry'), { messageId: `q-${RUN}`, persistent: true });
    await ch.waitForConfirms();
    await ch.close();

    await vi.waitFor(() => { expect(sink.received).toHaveLength(1); }, WAIT);
    expect(parsed(sink)).toMatchObject({ body: 'quorum retry', redelivered: true });
    expect(store.messageCount()).toBe(1);
    const left = await admin.createChannel();
    try {
      await vi.waitFor(async () => { expect((await left.checkQueue(names.quorum)).messageCount).toBe(0); }, WAIT);
    } finally {
      await left.close();
    }
  }, TEST_TIMEOUT);

  it('sends a message stored with an ERROR status to the dead-letter exchange', async () => {
    deployed.push(await deployChannel({
      channelId: '00000000-0000-0000-0000-amqpe2e0000d',
      dataType: 'RAW',
      source: source(),
      transformer: "throw new Error('cannot map this message');",
      destinations: [{ metaDataId: 1, name: 'sink', connector: new CaptureDestination() }],
    }));

    await publishDirect('poison');

    const ch = await admin.createChannel();
    try {
      await vi.waitFor(async () => {
        const dead = await ch.get(names.deadQueue, { noAck: true });
        expect(dead && dead.content.toString()).toBe('poison');
      }, WAIT);
    } finally {
      await ch.close();
    }
  }, TEST_TIMEOUT);

  it('delivers a message whose headers are nested 5,000 deep, once and whole, and the message behind it', async () => {
    const sink = new CaptureDestination();
    const store = createInMemoryStore();
    deployed.push(await deployChannel({
      channelId: '00000000-0000-0000-0000-amqpe2e00011',
      dataType: 'RAW',
      store,
      source: source(),
      transformer: ECHO_SOURCE_MAP,
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    }));

    await publishDirect('deep', { site: 'north', x: nestedTables(5_000) });
    await publishDirect('behind');

    await vi.waitFor(() => { expect(sink.received).toHaveLength(2); }, WAIT);
    expect(parsed(sink, 0)).toMatchObject({ body: 'deep', redelivered: false, headers: { site: 'north', x: nestedTablesJson(5_000) } });
    expect(parsed(sink, 1)).toMatchObject({ body: 'behind', redelivered: false, headers: { site: 'north' } });
    expect(store.messageCount()).toBe(2);
    const left = await admin.createChannel();
    try {
      await vi.waitFor(async () => { expect((await left.checkQueue(names.queue)).messageCount).toBe(0); }, WAIT);
    } finally {
      await left.close();
    }
  }, TEST_TIMEOUT);

  it('reconnects after the broker drops the connection and keeps consuming', async () => {
    const sink = new CaptureDestination();
    deployed.push(await deployChannel({
      channelId: '00000000-0000-0000-0000-amqpe2e0000e',
      dataType: 'RAW',
      source: new AmqpReceiver({ ...connection(), queue: names.dropped }, undefined, undefined, RETRY_MS),
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    }));
    const publish = async (body: string): Promise<void> => {
      const ch = await admin.createConfirmChannel();
      ch.sendToQueue(names.dropped, Buffer.from(body));
      await ch.waitForConfirms();
      await ch.close();
    };
    await publish('before');
    await vi.waitFor(() => { expect(sink.received.map((m) => m.content)).toEqual(['before']); }, WAIT);

    const cfg = requireAmqp();
    const api = `http://${cfg.host}:${String(cfg.managementPort)}/api`;
    const auth = { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}` };
    // By the queue, which only this test consumes: other connections on a shared broker have the same name.
    const consumer = async (): Promise<string> => {
      const queue = await (await fetch(`${api}/queues/%2F/${names.dropped}`, { headers: auth })).json() as { consumer_details?: { channel_details: { connection_name?: string } }[] };
      const connections = (queue.consumer_details ?? []).map((c) => c.channel_details.connection_name);
      expect(connections).toEqual([expect.stringMatching(/./)]);
      return connections[0]!;
    };
    // The management API is some seconds behind, and may list a consumer before it knows its connection.
    const dropped = await vi.waitFor(consumer, WAIT);
    expect((await fetch(`${api}/connections/${encodeURIComponent(dropped)}`, { method: 'DELETE', headers: auth })).ok).toBe(true);

    await publish('after');
    await vi.waitFor(() => { expect(sink.received.map((m) => m.content)).toEqual(['before', 'after']); }, WAIT);
    await vi.waitFor(async () => { expect(await consumer()).not.toBe(dropped); }, WAIT);
  }, 5 * WAIT.timeout);

  it('connection test finds the queue and the exchange, and reports a missing queue', async () => {
    await expect(testAmqpConnection(connection(), { queue: names.queue })).resolves.toContain(`queue ${names.queue}`);
    await expect(testAmqpConnection(connection(), { exchange: names.exchange })).resolves.toContain('exists');
    await expect(testAmqpConnection(connection(), { queue: `e2e-missing-${RUN}` })).rejects.toThrow();
    await expect(testAmqpConnection({ ...connection(), password: 'wrong' }, { queue: names.queue })).rejects.toThrow();
  }, TEST_TIMEOUT);
});

describeAmqpTls('AMQP connectors over TLS (real RabbitMQ)', () => {
  const queue = `e2e-tls-${RUN}`;
  let admin: ChannelModel;

  const tlsConnection = (): AmqpConnectionConfig => {
    const cfg = requireAmqp();
    const tls = requireAmqpTls();
    return { host: cfg.host, port: tls.port, vhost: '/', username: cfg.username, password: cfg.password, tls: { ca: tls.ca } };
  };

  beforeAll(async () => {
    const cfg = requireAmqp();
    admin = await amqpConnect({ hostname: cfg.host, port: cfg.port, username: cfg.username, password: cfg.password });
    const ch = await admin.createChannel();
    await ch.assertQueue(queue, { durable: true });
    await ch.close();
  });

  afterAll(async () => {
    const ch = await admin.createChannel();
    await ch.deleteQueue(queue);
    await admin.close();
  });

  it('publishes and consumes over AMQPS with the server certificate verified', async () => {
    const sink = new CaptureDestination();
    deployed.push(await deployChannel({
      channelId: '00000000-0000-0000-0000-amqpe2e00010',
      dataType: 'RAW',
      source: new AmqpReceiver({ ...tlsConnection(), queue }, undefined, undefined, RETRY_MS),
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    }));
    // The default exchange routes to the queue the routing key names.
    const dispatcher = new AmqpDispatcher({ ...tlsConnection(), exchange: '', routingKey: queue, headers: {}, contentType: 'text/plain' });
    await dispatcher.onStart();
    try {
      const sent = await dispatcher.send(
        { channelId: 'c', messageId: 1, metaDataId: 1, content: 'over tls', dataType: 'RAW' },
        AbortSignal.timeout(30_000),
      );
      expect(sent.ok && sent.value.status).toBe('SENT');
    } finally {
      await dispatcher.onStop();
    }
    await vi.waitFor(() => { expect(sink.lastContent()).toBe('over tls'); }, WAIT);
  }, TEST_TIMEOUT);

  it('refuses a broker certificate no trusted CA signed, and connects once the CA is given', async () => {
    await expect(testAmqpConnection({ ...tlsConnection(), tls: {} }, { queue })).rejects.toThrow(/self[- ]signed|certificate/i);
    await expect(testAmqpConnection(tlsConnection(), { queue })).resolves.toContain(`queue ${queue}`);
  }, TEST_TIMEOUT);
});
