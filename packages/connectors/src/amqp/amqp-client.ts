// ===========================================
// AMQP Client Adapter
// ===========================================
// The small part of amqplib the AMQP connectors use, behind interfaces a unit
// test can fake. Queues, exchanges and bindings belong to the broker's
// administrator: the connectors check that they exist and never declare them.

import { connect, type ChannelModel, type ConfirmChannel, type ConsumeMessage, type Options, type SocketOptions } from 'amqplib';
import type { TlsClientOptions } from '../tls.js';

// ----- Connection -----

export interface AmqpConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly vhost: string;
  readonly username: string;
  readonly password: string;
  /** PEM TLS settings; undefined connects in plaintext. */
  readonly tls?: TlsClientOptions | undefined;
}

/** Bound on connecting; also the heartbeat that detects a dead broker connection. */
const CONNECT_TIMEOUT_MS = 30_000;
const HEARTBEAT_SECONDS = 30;

/** Connection URL parts (credentials stay out of any URL string). */
export function connectOptions(config: AmqpConnectionConfig): Options.Connect {
  return {
    protocol: config.tls ? 'amqps' : 'amqp',
    hostname: config.host,
    port: config.port,
    vhost: config.vhost,
    heartbeat: HEARTBEAT_SECONDS,
    ...(config.username ? { username: config.username, password: config.password } : {}),
  };
}

/** Name the broker shows for these connections (RabbitMQ management UI, `rabbitmqctl list_connections`). */
export const AMQP_CONNECTION_NAME = 'galvaniflow';

/** Socket options: TLS checks stay on unless switched off. */
export function socketOptions(config: AmqpConnectionConfig): SocketOptions {
  const tls = config.tls;
  return {
    timeout: CONNECT_TIMEOUT_MS,
    clientProperties: { connection_name: AMQP_CONNECTION_NAME },
    ...(tls
      ? {
        servername: config.host,
        rejectUnauthorized: tls.rejectUnauthorized !== false,
        ...(tls.ca ? { ca: [tls.ca] } : {}),
        ...(tls.cert ? { cert: tls.cert } : {}),
        ...(tls.key ? { key: tls.key } : {}),
      }
      : {}),
  };
}

async function open(config: AmqpConnectionConfig): Promise<ChannelModel> {
  return connect(connectOptions(config), socketOptions(config));
}

/** Header values as JSON-safe values: byte strings as UTF-8 text, nested tables as JSON text. */
export function headersToRecord(headers: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (Buffer.isBuffer(value)) result[name] = value.toString('utf8');
    else if (typeof value === 'bigint') result[name] = value.toString();
    else if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) result[name] = value;
    else if (value instanceof Date) result[name] = value.toISOString();
    else result[name] = JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  }
  return result;
}

// ----- Consumer -----

/** One message delivered from a queue; it stays unacknowledged until ack or nack. */
export interface AmqpDelivery {
  readonly content: Buffer;
  readonly exchange: string;
  readonly routingKey: string;
  readonly redelivered: boolean;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly messageId: string | undefined;
  readonly contentType: string | undefined;
  /** Remove the message from the queue. Throws when the channel has closed. */
  ack(): void;
  /** Return the message to the queue (requeue) or reject it to the dead-letter exchange, if any. */
  nack(requeue: boolean): void;
}

export interface AmqpConsumeOptions extends AmqpConnectionConfig {
  readonly queue: string;
}

/** An open consumer. `closed` settles when the connection or channel goes away. */
export interface AmqpConsumer {
  readonly closed: Promise<Error>;
  close(): Promise<void>;
}

export type AmqpConsume = (options: AmqpConsumeOptions, onDelivery: (delivery: AmqpDelivery) => void) => Promise<AmqpConsumer>;

function toDelivery(channel: { ack(m: ConsumeMessage): void; nack(m: ConsumeMessage, all: boolean, requeue: boolean): void }, msg: ConsumeMessage): AmqpDelivery {
  return {
    content: msg.content,
    exchange: msg.fields.exchange,
    routingKey: msg.fields.routingKey,
    redelivered: msg.fields.redelivered,
    headers: headersToRecord(msg.properties.headers),
    messageId: typeof msg.properties.messageId === 'string' ? msg.properties.messageId : undefined,
    contentType: typeof msg.properties.contentType === 'string' ? msg.properties.contentType : undefined,
    ack: (): void => { channel.ack(msg); },
    nack: (requeue): void => { channel.nack(msg, false, requeue); },
  };
}

/**
 * Consume an existing queue with manual acknowledgement, one unacknowledged
 * message at a time (prefetch 1), so a message returned to the queue is
 * delivered again before the ones behind it.
 */
export const consumeAmqp: AmqpConsume = async (options, onDelivery) => {
  const model = await open(options);
  let lastError: Error | undefined;
  let settle: (err: Error) => void = () => undefined;
  const closed = new Promise<Error>((resolve) => { settle = resolve; });
  model.on('error', (err: Error) => { lastError = err; });
  model.on('close', (err?: Error) => { settle(err ?? lastError ?? new Error('AMQP connection closed')); });
  try {
    const channel = await model.createChannel();
    channel.on('error', (err: Error) => { lastError = err; });
    channel.on('close', () => { settle(lastError ?? new Error('AMQP channel closed')); });
    await channel.checkQueue(options.queue);
    await channel.prefetch(1);
    await channel.consume(options.queue, (msg) => {
      if (msg === null) {
        settle(new Error(`Queue ${options.queue} was deleted or the broker cancelled the consumer`));
        return;
      }
      onDelivery(toDelivery(channel, msg));
    }, { noAck: false });
  } catch (err) {
    await model.close().catch(() => undefined);
    throw err;
  }
  return {
    closed,
    close: async (): Promise<void> => { await model.close(); },
  };
};

// ----- Publisher -----

export interface AmqpOutbound {
  readonly exchange: string;
  readonly routingKey: string;
  readonly content: Buffer;
  readonly headers: Readonly<Record<string, string>>;
  readonly contentType: string;
  /** Same for every attempt at one message, so a consumer can spot a duplicate. */
  readonly messageId: string;
}

export interface AmqpPublisher {
  /** Resolves once the broker confirms it has routed and stored the message. */
  publish(message: AmqpOutbound): Promise<void>;
  readonly isOpen: boolean;
  close(): Promise<void>;
}

export type AmqpPublisherFactory = (config: AmqpConnectionConfig) => Promise<AmqpPublisher>;

/**
 * Publish persistent messages on a confirm channel with `mandatory` set. A
 * message no queue is bound to receive is returned by the broker before it
 * confirms, and that publish fails instead of the message being dropped.
 */
export const createAmqpPublisher: AmqpPublisherFactory = async (config) => {
  const model = await open(config);
  let connectionOpen = true;
  model.on('close', () => { connectionOpen = false; });
  model.on('error', () => { connectionOpen = false; });
  let channel: ConfirmChannel;
  try {
    channel = await model.createConfirmChannel();
  } catch (err) {
    await model.close().catch(() => undefined);
    throw err;
  }
  channel.on('close', () => { connectionOpen = false; });
  channel.on('error', () => { connectionOpen = false; });
  const returned = new Set<string>();
  channel.on('return', (msg: { properties: { messageId?: unknown } }) => {
    if (typeof msg.properties.messageId === 'string') returned.add(msg.properties.messageId);
  });

  return {
    get isOpen(): boolean { return connectionOpen; },
    publish: (message) => new Promise<void>((resolve, reject) => {
      returned.delete(message.messageId);
      try {
        channel.publish(message.exchange, message.routingKey, message.content, {
          persistent: true,
          mandatory: true,
          contentType: message.contentType,
          headers: message.headers,
          messageId: message.messageId,
          timestamp: Math.floor(Date.now() / 1000),
        }, (err: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new Error('Broker did not confirm the message (nack)'));
          } else if (returned.delete(message.messageId)) {
            reject(new Error(`No queue is bound to exchange "${message.exchange}" with routing key "${message.routingKey}"; the broker returned the message`));
          } else {
            resolve();
          }
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }),
    close: async (): Promise<void> => {
      connectionOpen = false;
      await model.close();
    },
  };
};

// ----- Connection test -----

/**
 * Connect, authenticate and check that the queue (source) or exchange
 * (destination; the default exchange always exists) is there.
 */
export async function testAmqpConnection(config: AmqpConnectionConfig, target: { queue: string } | { exchange: string }): Promise<string> {
  const model = await open(config);
  // A failed check closes the channel with an 'error' event; unheard, it would crash the process.
  model.on('error', () => undefined);
  try {
    const channel = await model.createChannel();
    channel.on('error', () => undefined);
    const where = `${config.host}:${String(config.port)}${config.vhost === '/' ? '' : ` vhost ${config.vhost}`}`;
    if ('queue' in target) {
      const queue = await channel.checkQueue(target.queue);
      return `Connected to ${where}: queue ${target.queue} has ${String(queue.messageCount)} message(s) and ${String(queue.consumerCount)} consumer(s)`;
    }
    if (target.exchange) await channel.checkExchange(target.exchange);
    return `Connected to ${where}: exchange ${target.exchange || '(default)'} exists`;
  } finally {
    await model.close().catch(() => undefined);
  }
}
