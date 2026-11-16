// ===========================================
// AMQP Dispatcher (Destination Connector)
// ===========================================
// Publishes each message to an exchange as a persistent message and reports
// SENT only after the broker confirms it. A message no queue would receive is
// an error, not a silent drop. Routing key and header values may use `${name}`,
// filled per message (D-252). The connection opens on the first send and
// reopens on the next send after it is lost.

import { tryCatch, type Result } from '@galvanigraph/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import { fillVariables } from '../base.js';
import { withTimeoutSignal } from '../timeout.js';
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

      const publish = async (): Promise<void> => {
        const publisher = await this.connection();
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
          // A lost connection is replaced on the next send.
          if (!publisher.isOpen) await this.dropConnection();
        }
      };
      await withTimeoutSignal(publish(), SEND_TIMEOUT_MS, 'AMQP publish', signal);
      return { status: 'SENT' as const, content: JSON.stringify({ exchange: this.config.exchange, routingKey, messageId }) };
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

  /** The open publisher, connecting first if there is none. Concurrent sends share one connect. */
  private async connection(): Promise<AmqpPublisher> {
    this.publisher ??= this.createPublisher(this.config);
    try {
      return await this.publisher;
    } catch (err) {
      this.publisher = null;
      throw err;
    }
  }

  private async dropConnection(): Promise<void> {
    const pending = this.publisher;
    this.publisher = null;
    if (!pending) return;
    try {
      await (await pending).close();
    } catch {
      // Already closed: the connection was lost, which is why it is being dropped.
    }
  }

  private async close(): Promise<void> {
    this.started = false;
    await this.dropConnection();
  }
}
