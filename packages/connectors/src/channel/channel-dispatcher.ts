// ===========================================
// Channel Dispatcher (Destination Connector)
// ===========================================
// Routes messages to another channel's source via in-memory dispatch.
// Looks up the target channel in the static channel registry.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import { getChannelDispatcher, hasChannel } from './channel-registry.js';

// ----- Config -----

export interface ChannelDispatcherConfig {
  readonly targetChannelId: string;
  readonly waitForResponse: boolean;
}

// ----- Dispatcher -----

export class ChannelDispatcher implements DestinationConnectorRuntime {
  private readonly config: ChannelDispatcherConfig;
  private started = false;

  constructor(config: ChannelDispatcherConfig) {
    this.config = config;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.targetChannelId) {
        throw new Error('Target channel ID is required');
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = true;
    });
  }

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      if (!this.started) throw new Error('Dispatcher not started');
      if (signal.aborted) throw new Error('Send aborted');

      const dispatcher = getChannelDispatcher(this.config.targetChannelId);
      if (!dispatcher) {
        return {
          status: 'ERROR' as const,
          content: '',
          errorMessage: `Target channel ${this.config.targetChannelId} is not deployed or not registered`,
        };
      }

      const result = await dispatcher({
        content: message.content,
        sourceMap: {
          connectorType: 'CHANNEL',
          sourceChannelId: message.channelId,
          sourceMessageId: message.messageId,
          sourceMetaDataId: message.metaDataId,
          ...(message.correlationId ? { correlationId: message.correlationId } : {}),
        },
      });

      if (!result.ok) {
        return {
          status: 'ERROR' as const,
          content: '',
          errorMessage: result.error.message,
        };
      }

      const responseContent = this.config.waitForResponse && result.value.response
        ? result.value.response
        : `messageId=${String(result.value.messageId)}`;

      return { status: 'SENT' as const, content: responseContent };
    });
  }

  /** Check if target channel is currently available. */
  isTargetAvailable(): boolean {
    return hasChannel(this.config.targetChannelId);
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }
}
