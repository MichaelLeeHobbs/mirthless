// ===========================================
// Channel Dispatcher (Destination Connector)
// ===========================================
// Routes messages to another channel's source via in-memory dispatch.
// Looks up the target channel in the static channel registry.

import { AsyncLocalStorage } from 'node:async_hooks';
import { tryCatch, type Result } from '@mirthless/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import { getChannelDispatcher, hasChannel } from './channel-registry.js';

// ----- Config -----

export interface ChannelDispatcherConfig {
  readonly targetChannelId: string;
  readonly waitForResponse: boolean;
}

/**
 * Maximum chained channel-to-channel hops for a single inbound message. Channel A
 * routing to B routing back to A would otherwise recurse in-memory until the stack
 * blows / the process OOMs. AsyncLocalStorage tracks the depth across the awaited
 * dispatch chain per message (correct under concurrent messages).
 */
const MAX_CHANNEL_HOPS = 10;
const hopDepth = new AsyncLocalStorage<number>();

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

      const depth = hopDepth.getStore() ?? 0;
      if (depth >= MAX_CHANNEL_HOPS) {
        return {
          status: 'ERROR' as const,
          content: '',
          errorMessage: `Channel routing loop detected: exceeded ${String(MAX_CHANNEL_HOPS)} chained channel hops (target ${this.config.targetChannelId})`,
        };
      }

      const dispatcher = getChannelDispatcher(this.config.targetChannelId);
      if (!dispatcher) {
        return {
          status: 'ERROR' as const,
          content: '',
          errorMessage: `Target channel ${this.config.targetChannelId} is not deployed or not registered`,
        };
      }

      const result = await hopDepth.run(depth + 1, () => dispatcher({
        content: message.content,
        sourceMap: {
          connectorType: 'CHANNEL',
          sourceChannelId: message.channelId,
          sourceMessageId: message.messageId,
          sourceMetaDataId: message.metaDataId,
          ...(message.correlationId ? { correlationId: message.correlationId } : {}),
        },
      }));

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
