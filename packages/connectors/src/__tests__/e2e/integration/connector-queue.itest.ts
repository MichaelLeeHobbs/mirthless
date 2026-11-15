// ===========================================
// Kafka and AMQP connectors — real brokers
// ===========================================
// Real messages through real brokers (docker compose --profile test up
// kafka-test rabbitmq-test):
//   Channel A: TCP source → Kafka/AMQP destination (topic, key, routing key and
//   headers filled per message from the channel map).
//   Channel B: Kafka/AMQP source → transform → sink.
// Plus: redelivery after the pipeline fails to store a message, SASL login,
// a message no queue would receive, dead-lettering of an ERROR message, the
// broker dropping the consumer's connection, requeue on a quorum queue, AMQPS
// with certificate checks, and the connection tests.
// Runs only when KAFKA_TEST_BROKERS / AMQP_TEST_HOST are set (AMQPS also needs
// the test CA that rabbitmq-test writes to docker/test-certs).

import { it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Admin } from '@platformatic/kafka';
import { connect as amqpConnect, type ChannelModel } from 'amqplib';
import {
  TcpMllpReceiver,
  KafkaReceiver,
  KafkaDispatcher,
  AmqpReceiver,
  AmqpDispatcher,
  testKafkaConnection,
  testAmqpConnection,
  type KafkaConnectionConfig,
  type AmqpConnectionConfig,
} from '../../../index.js';
import { createKafkaProducer } from '../../../kafka/kafka-client.js';
import {
  deployChannel,
  teardownAll,
  createInMemoryStore,
  CaptureDestination,
  type DeployedChannel,
  type InMemoryStore,
} from '../support/e2e-harness.js';
import { sendMllp } from '../support/tcp-helpers.js';
import { describeKafka, requireKafka, describeAmqp, requireAmqp, describeAmqpTls, requireAmqpTls } from './gates.js';

const RUN = randomUUID().slice(0, 8);
const WAIT = { timeout: 30_000, interval: 100 };
const TEST_TIMEOUT = 60_000;
/** Short pause before rejoining or requeueing, so the suite is quick. */
const RETRY_MS = 200;

let deployed: DeployedChannel[] = [];
afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
});

/** A store whose first `failures` attempts to record a message fail, as a database outage would. */
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

/** Puts the parts of the source map the connectors fill into the message, so the sink can check them. */
const ECHO_SOURCE_MAP = `return JSON.stringify({
  body: String(msg),
  topic: $s('topic'), key: $s('key'), headers: $s('headers'),
  routingKey: $s('routingKey'), redelivered: $s('redelivered'),
});`;

const parsed = (sink: CaptureDestination, i = 0): Record<string, unknown> =>
  JSON.parse(sink.received[i]?.content ?? '{}') as Record<string, unknown>;

// ===========================================
// Kafka
// ===========================================

describeKafka('Kafka connectors (real broker)', () => {
  const topics = {
    cascade: `e2e-north-${RUN}`,
    redelivery: `e2e-redelivery-${RUN}`,
    sasl: `e2e-sasl-${RUN}`,
  };

  const connection = (): KafkaConnectionConfig => ({
    brokers: requireKafka().brokers, clientId: 'galvaniflow-e2e', saslMechanism: 'NONE', saslUsername: '', saslPassword: '',
  });

  beforeAll(async () => {
    const admin = new Admin({ clientId: 'galvaniflow-e2e-admin', bootstrapBrokers: [requireKafka().brokers] });
    try {
      await admin.createTopics({ topics: Object.values(topics), partitions: 1, replicas: 1 });
    } finally {
      await admin.close();
    }
  });

  it('carries a message from a Kafka destination to a Kafka source, with topic, key and headers filled per message', async () => {
    const sink = new CaptureDestination();
    const consumer = await deployChannel({
      channelId: '00000000-0000-0000-0000-kafkae2e000b',
      dataType: 'RAW',
      source: new KafkaReceiver({ ...connection(), topic: topics.cascade, groupId: `g-cascade-${RUN}`, startFrom: 'EARLIEST' }, undefined, undefined, RETRY_MS),
      transformer: ECHO_SOURCE_MAP,
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });
    const producer = await deployChannel({
      channelId: '00000000-0000-0000-0000-kafkae2e000a',
      dataType: 'RAW',
      source: new TcpMllpReceiver({ host: '127.0.0.1', port: 17761, maxConnections: 5 }),
      transformer: "$c('site', 'north'); $c('patientId', 'P42'); return msg;",
      destinations: [{
        metaDataId: 1,
        name: 'Kafka Out',
        connector: new KafkaDispatcher({
          ...connection(),
          topic: `e2e-\${site}-${RUN}`,
          messageKey: '${patientId}',
          headers: { source: 'galvaniflow', patient: '${patientId}' },
        }),
      }],
    });
    deployed.push(producer, consumer);

    await sendMllp(17761, 'MSH|^~\\&|KAFKA');

    // Headers matter here: a record with headers once failed to encode (string header names).
    await vi.waitFor(() => { expect(sink.received).toHaveLength(1); }, WAIT);
    expect(parsed(sink)).toMatchObject({
      body: 'MSH|^~\\&|KAFKA',
      topic: topics.cascade,
      key: 'P42',
      headers: { source: 'galvaniflow', patient: 'P42' },
    });
  }, TEST_TIMEOUT);

  it('reads a record again when the pipeline could not store it, and commits it once stored', async () => {
    const send = async (value: string): Promise<void> => {
      const p = createKafkaProducer(connection());
      try {
        await p.send({ topic: topics.redelivery, key: undefined, value: Buffer.from(value), headers: {} });
      } finally {
        await p.close();
      }
    };
    const group = `g-redelivery-${RUN}`;
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
      brokers: cfg.saslBrokers, clientId: 'galvaniflow-e2e', saslMechanism: 'PLAIN', saslUsername: cfg.username, saslPassword: cfg.password,
    };
    const sink = new CaptureDestination();
    deployed.push(await deployChannel({
      channelId: '00000000-0000-0000-0000-kafkae2e000e',
      dataType: 'RAW',
      source: new KafkaReceiver({ ...sasl, topic: topics.sasl, groupId: `g-sasl-${RUN}`, startFrom: 'EARLIEST' }, undefined, undefined, RETRY_MS),
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

// ===========================================
// AMQP (RabbitMQ)
// ===========================================

describeAmqp('AMQP connectors (real RabbitMQ)', () => {
  const names = {
    exchange: `e2e-hl7-${RUN}`,
    queue: `e2e-adt-${RUN}`,
    deadExchange: `e2e-dlx-${RUN}`,
    deadQueue: `e2e-dead-${RUN}`,
    quorum: `e2e-quorum-${RUN}`,
  };
  let admin: ChannelModel;

  const connection = (): AmqpConnectionConfig => {
    const cfg = requireAmqp();
    return { host: cfg.host, port: cfg.port, vhost: '/', username: cfg.username, password: cfg.password };
  };

  /**
   * The broker's topology is the administrator's job; the suite plays administrator here.
   * The queues are durable because RabbitMQ 4.3+ refuses transient non-exclusive queues
   * (`transient_nonexcl_queues`); afterAll deletes them.
   */
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
    await ch.close();
  });

  afterAll(async () => {
    const ch = await admin.createChannel();
    for (const q of [names.queue, names.deadQueue, names.quorum]) await ch.deleteQueue(q);
    for (const e of [names.exchange, names.deadExchange]) await ch.deleteExchange(e);
    await admin.close();
  });

  const publishDirect = async (body: string): Promise<void> => {
    const ch = await admin.createConfirmChannel();
    ch.publish(names.exchange, 'adt.a01', Buffer.from(body), { headers: { site: 'north' } });
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
    const producer = await deployChannel({
      channelId: '00000000-0000-0000-0000-amqpe2e0000a',
      dataType: 'RAW',
      source: new TcpMllpReceiver({ host: '127.0.0.1', port: 17762, maxConnections: 5 }),
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

    await sendMllp(17762, 'MSH|^~\\&|AMQP');

    await vi.waitFor(() => { expect(sink.received).toHaveLength(1); }, WAIT);
    expect(parsed(sink)).toMatchObject({
      body: 'MSH|^~\\&|AMQP',
      routingKey: 'adt.a01',
      headers: { patient: 'P42' },
      redelivered: false,
    });
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

    // Two failed stores, two requeues, then the third delivery is stored once.
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

  it('reconnects after the broker drops the connection and keeps consuming', async () => {
    const sink = new CaptureDestination();
    deployed.push(await deployChannel({
      channelId: '00000000-0000-0000-0000-amqpe2e0000e',
      dataType: 'RAW',
      source: source(),
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    }));
    await publishDirect('before');
    await vi.waitFor(() => { expect(sink.received.map((m) => m.content)).toEqual(['before']); }, WAIT);

    // Close the connector's connection from the broker side (it names itself "galvaniflow").
    const cfg = requireAmqp();
    const api = `http://${cfg.host}:${String(cfg.managementPort)}/api/connections`;
    const auth = { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}` };
    const victims = await vi.waitFor(async () => {
      const list = await (await fetch(api, { headers: auth })).json() as { name: string; client_properties?: { connection_name?: string } }[];
      const ours = list.filter((c) => c.client_properties?.connection_name === 'galvaniflow');
      expect(ours.length).toBeGreaterThan(0);
      return ours;
    }, WAIT);
    for (const c of victims) {
      const res = await fetch(`${api}/${encodeURIComponent(c.name)}`, { method: 'DELETE', headers: auth });
      expect(res.ok).toBe(true);
    }

    await publishDirect('after');
    await vi.waitFor(() => { expect(sink.received.map((m) => m.content)).toEqual(['before', 'after']); }, WAIT);
  }, TEST_TIMEOUT);

  it('connection test finds the queue and the exchange, and reports a missing queue', async () => {
    await expect(testAmqpConnection(connection(), { queue: names.queue })).resolves.toContain(`queue ${names.queue}`);
    await expect(testAmqpConnection(connection(), { exchange: names.exchange })).resolves.toContain('exists');
    await expect(testAmqpConnection(connection(), { queue: `e2e-missing-${RUN}` })).rejects.toThrow();
    await expect(testAmqpConnection({ ...connection(), password: 'wrong' }, { queue: names.queue })).rejects.toThrow();
  }, TEST_TIMEOUT);
});

// ===========================================
// AMQP over TLS (RabbitMQ's AMQPS listener)
// ===========================================

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
    // TLS on, no CA: the test CA is not in Node's trust store, so verification fails.
    await expect(testAmqpConnection({ ...tlsConnection(), tls: {} }, { queue })).rejects.toThrow(/self[- ]signed|certificate/i);
    await expect(testAmqpConnection(tlsConnection(), { queue })).resolves.toContain(`queue ${queue}`);
  }, TEST_TIMEOUT);
});
