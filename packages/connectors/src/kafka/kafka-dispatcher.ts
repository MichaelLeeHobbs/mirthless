// ===========================================
// Kafka Dispatcher (Destination Connector)
// ===========================================
// Publishes each message to a topic and reports SENT only after every in-sync
// replica has it (acks = all). Topic, key and header values may use `${name}`,
// filled per message (D-252). A topic naming a variable the message lacks is an
// error rather than a publish to a topic called `${...}`.

import { tryCatch, type Result } from '@galvaniflow/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import { fillVariables } from '../base.js';
import { withTimeoutSignal } from '../timeout.js';
import {
  createKafkaProducer,
  parseBrokers,
  type KafkaConnectionConfig,
  type KafkaProducerClient,
  type KafkaProducerFactory,
} from './kafka-client.js';

const SEND_TIMEOUT_MS = 30_000;

export interface KafkaDispatcherConfig extends KafkaConnectionConfig {
  readonly topic: string;
  /** Empty sends no key. */
  readonly key: string;
  readonly headers: Readonly<Record<string, string>>;
}

export class KafkaDispatcher implements DestinationConnectorRuntime {
  private readonly config: KafkaDispatcherConfig;
  private readonly createProducer: KafkaProducerFactory;
  private producer: KafkaProducerClient | null = null;

  constructor(config: KafkaDispatcherConfig, createProducer?: KafkaProducerFactory) {
    this.config = config;
    this.createProducer = createProducer ?? createKafkaProducer;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (parseBrokers(this.config.brokers).length === 0) throw new Error('At least one broker is required');
      if (!this.config.topic) throw new Error('Topic is required');
    });
  }

  /** The producer connects on its first send, so a broker that is down fails sends (and queues), not the start. */
  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.producer ??= this.createProducer(this.config);
    });
  }

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      const producer = this.producer;
      if (!producer) throw new Error('Dispatcher not started');
      if (signal.aborted) throw new Error('Send aborted');

      const topic = fillVariables(this.config.topic, message);
      if (topic.includes('${')) {
        return { status: 'ERROR' as const, content: '', errorMessage: `Topic ${this.config.topic} names a variable this message does not have` };
      }
      const key = this.config.key ? fillVariables(this.config.key, message) : '';
      const headers: Record<string, Buffer> = {};
      for (const [name, value] of Object.entries(this.config.headers)) {
        headers[name] = Buffer.from(fillVariables(value, message), 'utf8');
      }

      const written = await withTimeoutSignal(producer.send({
        topic,
        key: key ? Buffer.from(key, 'utf8') : undefined,
        value: Buffer.from(message.content, 'utf8'),
        headers,
      }), SEND_TIMEOUT_MS, 'Kafka send', signal);
      return { status: 'SENT' as const, content: JSON.stringify(written ?? { topic }) };
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => { await this.close(); });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => { await this.close(); });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => { await this.close(); });
  }

  private async close(): Promise<void> {
    const producer = this.producer;
    this.producer = null;
    if (producer) await producer.close();
  }
}
