// Routing key and header values may use `${name}`, filled per message (D-252).

import { settleWithin, tryCatch, type Result } from '@galvanigraph/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import { fillVariables, variableNames } from '../base.js';
import { withTimeoutSignal } from '../timeout.js';
import { HALT_CLOSE_MS, STOP_CLOSE_MS } from '../client-lifecycle.js';
import { createAmqpPublisher, type AmqpConnectionConfig, type AmqpPublisher, type AmqpPublisherFactory } from './amqp-client.js';

const SEND_TIMEOUT_MS = 30_000;

export interface AmqpDispatcherConfig extends AmqpConnectionConfig {
  /** Empty is the default exchange, which routes to the queue named by the routing key. */
  readonly exchange: string;
  readonly routingKey: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly contentType: string;
}

export class AmqpDispatcher implements DestinationConnectorRuntime {
  private readonly config: AmqpDispatcherConfig;
  private readonly createPublisher: AmqpPublisherFactory;
  private started = false;
  private publisher: Promise<AmqpPublisher> | null = null;

  constructor(config: AmqpDispatcherConfig, createPublisher?: AmqpPublisherFactory) {
    this.config = config;
    this.createPublisher = createPublisher ?? createAmqpPublisher;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.host) throw new Error('Host is required');
      if (this.config.port < 1 || this.config.port > 65535) throw new Error('Port must be between 1 and 65535');
      if (!this.config.exchange && !this.config.routingKey) {
        throw new Error('The default exchange needs a routing key (the queue name)');
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => { this.started = true; });
  }

  variablesUsed(): readonly string[] {
    return variableNames([this.config.routingKey, ...Object.values(this.config.headers)]);
  }

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      if (!this.started) throw new Error('Dispatcher not started');
      if (signal.aborted) throw new Error('Send aborted');

      const routingKey = fillVariables(this.config.routingKey, message);
      if (routingKey.includes('${')) {
        return { status: 'ERROR' as const, content: '', errorMessage: `Routing key ${this.config.routingKey} names a variable this message does not have` };
      }
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(this.config.headers)) headers[name] = fillVariables(value, message);
      const messageId = `${message.channelId}:${String(message.messageId)}:${String(message.metaDataId)}`;

      const ended = AbortSignal.any([signal, AbortSignal.timeout(SEND_TIMEOUT_MS)]);
      const publish = async (): Promise<void> => {
        const publisher = await this.connection();
        // The send was given up while the connection opened; its message may be on the queue again.
        if (ended.aborted) throw new Error('Send aborted');
        try {
          await publisher.publish({
            exchange: this.config.exchange,
            routingKey,
            content: Buffer.from(message.content, 'utf8'),
            headers,
            contentType: this.config.contentType,
            messageId,
          });
        } finally {
          if (!publisher.isOpen) await this.dropConnection(HALT_CLOSE_MS);
        }
      };
      await withTimeoutSignal(publish(), SEND_TIMEOUT_MS, 'AMQP publish', signal);
      return { status: 'SENT' as const, content: JSON.stringify({ exchange: this.config.exchange, routingKey, messageId }) };
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

  /** Concurrent sends share one connect. */
  private async connection(): Promise<AmqpPublisher> {
    this.publisher ??= this.createPublisher(this.config);
    try {
      return await this.publisher;
    } catch (err) {
      this.publisher = null;
      throw err;
    }
  }

  /** One still connecting is closed when it is connected. */
  private async dropConnection(timeoutMs: number): Promise<void> {
    const pending = this.publisher;
    this.publisher = null;
    if (pending) await settleWithin(pending.then((publisher) => publisher.close(timeoutMs)), timeoutMs);
  }

  private async close(timeoutMs: number): Promise<void> {
    this.started = false;
    await this.dropConnection(timeoutMs);
  }
}
