// ===========================================
// Kafka Client Adapter
// ===========================================
// The small part of @platformatic/kafka the Kafka connectors use, behind
// interfaces a unit test can fake. Group membership, partition assignment and
// offset storage stay with the broker and the client (D-261).

import { Admin, Consumer, Producer, ProduceAcks, type SASLOptions } from '@platformatic/kafka';
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls';
import type { TlsClientOptions } from '../tls.js';

// ----- Connection -----

export const KAFKA_SASL_MECHANISM = {
  NONE: 'NONE',
  PLAIN: 'PLAIN',
  SCRAM_SHA_256: 'SCRAM-SHA-256',
  SCRAM_SHA_512: 'SCRAM-SHA-512',
} as const;
export type KafkaSaslMechanism = typeof KAFKA_SASL_MECHANISM[keyof typeof KAFKA_SASL_MECHANISM];

/** How to reach and authenticate to a Kafka cluster. */
export interface KafkaConnectionConfig {
  /** `host:port` entries, comma separated. */
  readonly brokers: string;
  readonly clientId: string;
  /** PEM TLS settings; undefined connects in plaintext. */
  readonly tls?: TlsClientOptions | undefined;
  readonly saslMechanism: KafkaSaslMechanism;
  readonly saslUsername: string;
  readonly saslPassword: string;
}

/** Bound on each broker request and on connecting. */
const KAFKA_REQUEST_TIMEOUT_MS = 30_000;

/** Split the broker list into `host:port` entries. */
export function parseBrokers(brokers: string): string[] {
  return brokers.split(',').map((b) => b.trim()).filter((b) => b.length > 0);
}

/** Node TLS options for the client; certificate checks stay on unless switched off. */
function toNodeTls(tls: TlsClientOptions): TlsConnectionOptions {
  return {
    rejectUnauthorized: tls.rejectUnauthorized !== false,
    ...(tls.ca ? { ca: tls.ca } : {}),
    ...(tls.cert ? { cert: tls.cert } : {}),
    ...(tls.key ? { key: tls.key } : {}),
  };
}

/** Options every @platformatic/kafka client takes. */
export function clientOptions(config: KafkaConnectionConfig): {
  clientId: string;
  bootstrapBrokers: string[];
  timeout: number;
  tls?: TlsConnectionOptions;
  sasl?: SASLOptions;
} {
  return {
    clientId: config.clientId,
    bootstrapBrokers: parseBrokers(config.brokers),
    timeout: KAFKA_REQUEST_TIMEOUT_MS,
    ...(config.tls ? { tls: toNodeTls(config.tls) } : {}),
    ...(config.saslMechanism === KAFKA_SASL_MECHANISM.NONE
      ? {}
      : { sasl: { mechanism: config.saslMechanism, username: config.saslUsername, password: config.saslPassword } }),
  };
}

// ----- Consumer -----

/** One record read from a topic. */
export interface KafkaInboundRecord {
  readonly topic: string;
  readonly partition: number;
  readonly offset: bigint;
  readonly timestamp: bigint;
  readonly key: Buffer | undefined;
  readonly value: Buffer | undefined;
  readonly headers: ReadonlyMap<Buffer, Buffer>;
  /** Commit this record's offset (and every earlier one in its partition) for the group. */
  commit(): Promise<void>;
}

/** An open subscription: records in offset order per partition, then close. */
export interface KafkaSubscription extends AsyncIterable<KafkaInboundRecord> {
  close(force: boolean): Promise<void>;
}

export interface KafkaSubscribeOptions extends KafkaConnectionConfig {
  readonly topic: string;
  readonly groupId: string;
  /** Where to start when the group has no committed offset. */
  readonly startFrom: 'EARLIEST' | 'LATEST';
}

export type KafkaSubscribe = (options: KafkaSubscribeOptions) => Promise<KafkaSubscription>;

/**
 * Join the consumer group and read from its committed offsets. Offsets are
 * committed only by {@link KafkaInboundRecord.commit}, never automatically.
 */
export const subscribeKafka: KafkaSubscribe = async (options) => {
  const consumer = new Consumer({
    ...clientOptions(options),
    groupId: options.groupId,
    autocommit: false,
  });
  try {
    const stream = await consumer.consume({
      topics: [options.topic],
      mode: 'committed',
      fallbackMode: options.startFrom === 'EARLIEST' ? 'earliest' : 'latest',
      autocommit: false,
    });
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<KafkaInboundRecord> {
        for await (const message of stream) {
          yield {
            topic: message.topic,
            partition: message.partition,
            offset: message.offset,
            timestamp: message.timestamp,
            key: message.key,
            value: message.value,
            headers: message.headers,
            commit: async (): Promise<void> => { await message.commit(); },
          };
        }
      },
      async close(force: boolean): Promise<void> {
        try {
          await stream.close();
        } finally {
          await consumer.close(force);
        }
      },
    };
  } catch (err) {
    await consumer.close(true).catch(() => undefined);
    throw err;
  }
};

// ----- Producer -----

export interface KafkaOutboundRecord {
  readonly topic: string;
  readonly key: Buffer | undefined;
  readonly value: Buffer;
  readonly headers: Readonly<Record<string, Buffer>>;
}

/** Where the broker stored a record. */
export interface KafkaWriteResult {
  readonly topic: string;
  readonly partition: number;
  readonly offset: string;
}

export interface KafkaProducerClient {
  /** Resolves once every in-sync replica has the record (acks = all). */
  send(record: KafkaOutboundRecord): Promise<KafkaWriteResult | undefined>;
  close(): Promise<void>;
}

export type KafkaProducerFactory = (config: KafkaConnectionConfig) => KafkaProducerClient;

/**
 * The client reports a failed request as "Producing messages failed." with the
 * reasons nested in `errors`/`cause`; put them in the message an operator sees.
 */
export function describeKafkaError(err: unknown): Error {
  if (!(err instanceof Error)) return new Error(String(err));
  const reasons: string[] = [];
  const pending: unknown[] = [err];
  while (pending.length > 0 && reasons.length < 10) {
    const next = pending.shift();
    if (!(next instanceof Error)) continue;
    if (next !== err && next.message) reasons.push(next.message);
    const nested = (next as { errors?: unknown }).errors;
    if (Array.isArray(nested)) pending.push(...(nested as unknown[]));
    if (next.cause !== undefined) pending.push(next.cause);
  }
  const unique = [...new Set(reasons)].filter((r) => r !== err.message);
  return unique.length === 0 ? err : new Error(`${err.message} ${unique.join('; ')}`, { cause: err });
}

export const createKafkaProducer: KafkaProducerFactory = (config) => {
  const producer = new Producer({ ...clientOptions(config), acks: ProduceAcks.ALL });
  return {
    async send(record): Promise<KafkaWriteResult | undefined> {
      let result;
      try {
        result = await producer.send({
          messages: [{
            topic: record.topic,
            value: record.value,
            // With the default (Buffer) serializers, header names must be Buffers too.
            headers: new Map(Object.entries(record.headers).map(([name, value]) => [Buffer.from(name, 'utf8'), value])),
            ...(record.key ? { key: record.key } : {}),
          }],
        });
      } catch (err) {
        throw describeKafkaError(err);
      }
      const written = result.offsets?.[0];
      return written
        ? { topic: written.topic, partition: written.partition, offset: written.offset.toString() }
        : undefined;
    },
    async close(): Promise<void> {
      await producer.close();
    },
  };
};

// ----- Connection test -----

/**
 * Connect, authenticate and read cluster metadata; with a topic, also check
 * that the topic exists. Returns a one-line description of what was found.
 */
export async function testKafkaConnection(config: KafkaConnectionConfig, topic?: string): Promise<string> {
  const admin = new Admin(clientOptions(config));
  try {
    const metadata = await admin.metadata(topic ? { topics: [topic] } : {}).catch((err: unknown) => { throw describeKafkaError(err); });
    const brokers = `${String(metadata.brokers.size)} broker(s)`;
    if (!topic) return `Connected to Kafka cluster ${metadata.id}: ${brokers}`;
    const found = metadata.topics.get(topic);
    if (!found) throw new Error(`Topic ${topic} does not exist`);
    return `Connected to Kafka cluster ${metadata.id}: ${brokers}, topic ${topic} has ${String(found.partitionsCount)} partition(s)`;
  } finally {
    await admin.close().catch(() => undefined);
  }
}
