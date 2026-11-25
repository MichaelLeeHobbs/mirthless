// Topic, key and header values may use `${name}`, filled per message (D-252).

import { tryCatch, type Result } from '@galvanigraph/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import { fillVariables, variableNames } from '../base.js';
import { createConnectorLogger, type ConnectorLogger } from '../logger.js';
import { withTimeoutSignal } from '../timeout.js';
import { closeQuietly, HALT_CLOSE_MS, STOP_CLOSE_MS } from '../client-lifecycle.js';
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
  /** The record key; empty sends no key. */
  readonly messageKey: string;
  readonly headers: Readonly<Record<string, string>>;
}

export class KafkaDispatcher implements DestinationConnectorRuntime {
  private readonly config: KafkaDispatcherConfig;
  private readonly createProducer: KafkaProducerFactory;
  private readonly logger: ConnectorLogger;
  private producer: KafkaProducerClient | null = null;

  constructor(config: KafkaDispatcherConfig, createProducer?: KafkaProducerFactory, logger?: ConnectorLogger) {
    this.config = config;
    this.createProducer = createProducer ?? createKafkaProducer;
    this.logger = logger ?? createConnectorLogger('KAFKA');
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

  variablesUsed(): readonly string[] {
    return variableNames([this.config.topic, this.config.messageKey, ...Object.values(this.config.headers)]);
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
      const key = this.config.messageKey ? fillVariables(this.config.messageKey, message) : '';
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
    return tryCatch(async () => { await this.close(STOP_CLOSE_MS); });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => { await this.close(HALT_CLOSE_MS); });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => { await this.close(STOP_CLOSE_MS); });
  }

  private async close(timeoutMs: number): Promise<void> {
    const { producer } = this;
    this.producer = null;
    if (!producer) return;
    await closeQuietly({
      close: () => producer.close(),
      timeoutMs,
      label: 'Kafka close',
      logger: this.logger,
      message: 'Error closing Kafka producer',
    });
  }
}
