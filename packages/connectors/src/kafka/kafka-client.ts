// Group membership, partition assignment and offset storage stay with the broker and the client (D-261).

import { Admin, Consumer, Producer, ProduceAcks, type SASLOptions } from '@platformatic/kafka';
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls';
import type { TlsClientOptions } from '../tls.js';

export const KAFKA_SASL_MECHANISM = {
  NONE: 'NONE',
  PLAIN: 'PLAIN',
  SCRAM_SHA_256: 'SCRAM-SHA-256',
  SCRAM_SHA_512: 'SCRAM-SHA-512',
} as const;
export type KafkaSaslMechanism = typeof KAFKA_SASL_MECHANISM[keyof typeof KAFKA_SASL_MECHANISM];

export interface KafkaConnectionConfig {
  /** `host:port` entries, comma separated. */
  readonly brokers: string;
  readonly clientId: string;
  /** Undefined connects in plaintext. */
  readonly tls?: TlsClientOptions | undefined;
  readonly saslMechanism: KafkaSaslMechanism;
  readonly saslUsername: string;
  readonly saslPassword: string;
}

const KAFKA_REQUEST_TIMEOUT_MS = 30_000;
/** The client's default; it must stay above 1, or an idempotent producer retries without limit. */
const KAFKA_SEND_RETRIES = 3;

export function parseBrokers(brokers: string): string[] {
  return brokers.split(',').map((b) => b.trim()).filter((b) => b.length > 0);
}

function toNodeTls(tls: TlsClientOptions): TlsConnectionOptions {
  return {
    rejectUnauthorized: tls.rejectUnauthorized !== false,
    ...(tls.ca ? { ca: tls.ca } : {}),
    ...(tls.cert ? { cert: tls.cert } : {}),
    ...(tls.key ? { key: tls.key } : {}),
  };
}

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

export interface KafkaInboundRecord {
  readonly topic: string;
  readonly partition: number;
  readonly offset: bigint;
  readonly timestamp: bigint;
  readonly key: Buffer | undefined;
  readonly value: Buffer | undefined;
  readonly headers: ReadonlyMap<Buffer, Buffer>;
  /** Also commits every earlier offset in its partition. */
  commit(): Promise<void>;
}

/** Records arrive in offset order per partition. */
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

/** Never commits automatically: only {@link KafkaInboundRecord.commit} does. */
export const subscribeKafka: KafkaSubscribe = async (options) => {
  const consumer = new Consumer({
    ...clientOptions(options),
    groupId: options.groupId,
    autocommit: false,
  });
  // The consumer emits 'error' when it cannot rejoin the group after a failed heartbeat,
  // even between records; unheard, it ends the process. Ending the stream with it makes
  // the iteration throw and the receiver rejoin.
  let stream: Awaited<ReturnType<typeof consumer.consume>> | null = null;
  let consumerError: Error | null = null;
  consumer.on('error', (err: unknown) => {
    consumerError = describeKafkaError(err);
    stream?.destroy(consumerError);
  });
  try {
    stream = await consumer.consume({
      topics: [options.topic],
      mode: 'committed',
      fallbackMode: options.startFrom === 'EARLIEST' ? 'earliest' : 'latest',
      autocommit: false,
    });
    if (consumerError) stream.destroy(consumerError);
    const messages = stream;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<KafkaInboundRecord> {
        for await (const message of messages) {
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
          await messages.close();
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

export interface KafkaOutboundRecord {
  readonly topic: string;
  readonly key: Buffer | undefined;
  readonly value: Buffer;
  readonly headers: Readonly<Record<string, Buffer>>;
}

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
  // Idempotent, so a retried request whose answer was lost is not written twice. That
  // alone retries without limit; the cap stops a send the dispatcher gave up on.
  const producer = new Producer({ ...clientOptions(config), acks: ProduceAcks.ALL, idempotent: true, retries: KAFKA_SEND_RETRIES });
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
