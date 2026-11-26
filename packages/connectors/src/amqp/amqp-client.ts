// Queues, exchanges and bindings are the broker administrator's: check them, never declare them (D-266).

import { connect, type Channel, type ChannelModel, type ConfirmChannel, type ConsumeMessage, type Options, type SocketOptions } from 'amqplib';
import { isPlainObject, settleWithin } from '@galvanigraph/core-util';
import { STOP_CLOSE_MS } from '../client-lifecycle.js';
import { TimeoutError } from '../timeout.js';
import type { TlsClientOptions } from '../tls.js';

export interface AmqpConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly vhost: string;
  readonly username: string;
  readonly password: string;
  /** Undefined connects in plaintext. */
  readonly tls?: TlsClientOptions | undefined;
}

const CONNECT_TIMEOUT_MS = 30_000;
const HEARTBEAT_SECONDS = 30;

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
export const AMQP_CONNECTION_NAME = 'galvanigraph';

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

/**
 * amqplib waits for the broker to answer the close, and its types leave out the connection's socket.
 * The channel goes first: the close of the connection overtakes an acknowledgement just sent on it.
 */
async function close(model: ChannelModel, timeoutMs: number, channel?: Channel): Promise<void> {
  const closing = async (): Promise<void> => {
    await channel?.close().catch(() => undefined);
    await model.close();
  };
  if (await settleWithin(closing(), timeoutMs)) return;
  const unanswered = new TimeoutError('AMQP close', timeoutMs);
  // With an error, or amqplib does not notice until its heartbeat does.
  (model.connection as { readonly stream?: { destroy(err: Error): unknown } }).stream?.destroy(unanswered);
  throw unanswered;
}

interface OpenContainer {
  readonly entries: Iterator<readonly [prefix: string, value: unknown]>;
  readonly end: string;
  comma: string;
}

function* arrayEntries(items: readonly unknown[]): Generator<readonly [string, unknown]> {
  for (const item of items) yield ['', item];
}

function* tableEntries(table: Readonly<Record<string, unknown>>): Generator<readonly [string, unknown]> {
  for (const name of Object.keys(table)) yield [`${JSON.stringify(name)}:`, table[name]];
}

/** Null for a value with nothing nested in it. */
function openContainer(value: unknown): OpenContainer | null {
  if (Array.isArray(value)) return { entries: arrayEntries(value), end: ']', comma: '' };
  if (!isPlainObject(value) || Buffer.isBuffer(value) || value instanceof Date) return null;
  return { entries: tableEntries(value), end: '}', comma: '' };
}

/**
 * Not JSON.stringify, which overflows the stack a few thousand levels down when it has a replacer
 * (big integers need one) or meets bytes (D-331).
 */
function nestedHeaderJson(header: unknown): string {
  const parts: string[] = [];
  const containers: OpenContainer[] = [];
  const write = (value: unknown): void => {
    const container = openContainer(value);
    if (container) {
      containers.push(container);
      parts.push(container.end === ']' ? '[' : '{');
    } else {
      parts.push(JSON.stringify(typeof value === 'bigint' ? value.toString() : value ?? null));
    }
  };
  write(header);
  for (let current = containers.at(-1); current; current = containers.at(-1)) {
    const entry = current.entries.next();
    if (entry.done) {
      parts.push(current.end);
      containers.pop();
      continue;
    }
    const [prefix, value] = entry.value;
    parts.push(current.comma + prefix);
    current.comma = ',';
    write(value);
  }
  return parts.join('');
}

function headerValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (typeof value === 'bigint') return value.toString();
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value instanceof Date) return value.toISOString();
  return nestedHeaderJson(value);
}

/** `fromEntries`, because assigning a header named `__proto__` sets no property. */
export function headersToRecord(headers: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(headers ?? {}).map(([name, value]) => [name, headerValue(value)]));
}

/** Stays unacknowledged until ack or nack. */
export interface AmqpDelivery {
  readonly content: Buffer;
  readonly exchange: string;
  readonly routingKey: string;
  readonly redelivered: boolean;
  /** As decoded; {@link headersToRecord} makes them fit a source map. */
  readonly headers: Readonly<Record<string, unknown>> | undefined;
  readonly messageId: string | undefined;
  readonly contentType: string | undefined;
  /** Throws when the channel has closed. */
  ack(): void;
  /** Return the message to the queue (requeue) or reject it to the dead-letter exchange, if any. */
  nack(requeue: boolean): void;
}

export interface AmqpConsumeOptions extends AmqpConnectionConfig {
  readonly queue: string;
}

/** `closed` settles when the connection or channel goes away. */
export interface AmqpConsumer {
  readonly closed: Promise<Error>;
  /** Ends in this time: a broker that does not answer loses the connection, and this rejects. */
  close(timeoutMs: number): Promise<void>;
}

/** A throw from `onDelivery` closes the channel, and the message is delivered again without end: do fallible work after it returns. */
export type AmqpConsume = (options: AmqpConsumeOptions, onDelivery: (delivery: AmqpDelivery) => void) => Promise<AmqpConsumer>;

function toDelivery(channel: { ack(m: ConsumeMessage): void; nack(m: ConsumeMessage, all: boolean, requeue: boolean): void }, msg: ConsumeMessage): AmqpDelivery {
  return {
    content: msg.content,
    exchange: msg.fields.exchange,
    routingKey: msg.fields.routingKey,
    redelivered: msg.fields.redelivered,
    headers: msg.properties.headers,
    messageId: typeof msg.properties.messageId === 'string' ? msg.properties.messageId : undefined,
    contentType: typeof msg.properties.contentType === 'string' ? msg.properties.contentType : undefined,
    ack: (): void => { channel.ack(msg); },
    nack: (requeue): void => { channel.nack(msg, false, requeue); },
  };
}

/** Prefetch 1, so a message returned to the queue is delivered again before the ones behind it. */
export const consumeAmqp: AmqpConsume = async (options, onDelivery) => {
  const model = await open(options);
  let lastError: Error | undefined;
  let settle: (err: Error) => void = () => undefined;
  const closed = new Promise<Error>((resolve) => { settle = resolve; });
  model.on('error', (err: Error) => { lastError = err; });
  model.on('close', (err?: Error) => { settle(err ?? lastError ?? new Error('AMQP connection closed')); });
  let channel: Channel;
  try {
    channel = await model.createChannel();
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
    await close(model, STOP_CLOSE_MS).catch(() => undefined);
    throw err;
  }
  return {
    closed,
    close: (timeoutMs) => close(model, timeoutMs, channel),
  };
};

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
  /** As {@link AmqpConsumer.close}. */
  close(timeoutMs: number): Promise<void>;
}

export type AmqpPublisherFactory = (config: AmqpConnectionConfig) => Promise<AmqpPublisher>;

/** With `mandatory`, the broker returns a message no queue receives before it confirms; that publish fails instead of the message being dropped. */
export const createAmqpPublisher: AmqpPublisherFactory = async (config) => {
  const model = await open(config);
  let connectionOpen = true;
  model.on('close', () => { connectionOpen = false; });
  model.on('error', () => { connectionOpen = false; });
  let channel: ConfirmChannel;
  try {
    channel = await model.createConfirmChannel();
  } catch (err) {
    await close(model, STOP_CLOSE_MS).catch(() => undefined);
    throw err;
  }
  // amqplib emits the broker's reason (a missing exchange: 404 NOT_FOUND) before it fails each unconfirmed
  // publish with only "channel closed".
  let closedBy: Error | null = null;
  channel.on('close', () => { connectionOpen = false; });
  channel.on('error', (err: Error) => { connectionOpen = false; closedBy = err; });
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
            reject(closedBy ?? (err instanceof Error ? err : new Error('Broker did not confirm the message (nack)')));
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
    close: async (timeoutMs): Promise<void> => {
      connectionOpen = false;
      await close(model, timeoutMs);
    },
  };
};

/** The default exchange ('') always exists, so it is not checked. */
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
    await close(model, STOP_CLOSE_MS).catch(() => undefined);
  }
}
