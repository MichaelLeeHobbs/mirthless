// ===========================================
// Channel Receiver (Source Connector)
// ===========================================
// Receives messages routed from other channels via in-memory dispatch.
// Registers this channel's dispatcher in the static channel registry
// so ChannelDispatcher destinations can route messages here.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { SourceConnectorRuntime, MessageDispatcher } from '../base.js';
import { registerChannel, unregisterChannel } from './channel-registry.js';

// ----- Config -----

export interface ChannelReceiverConfig {
  readonly channelId: string;
}

// ----- Receiver -----

export class ChannelReceiver implements SourceConnectorRuntime {
  private readonly config: ChannelReceiverConfig;
  private dispatcher: MessageDispatcher | null = null;

  constructor(config: ChannelReceiverConfig) {
    this.config = config;
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.channelId) {
        throw new Error('Channel ID is required');
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }
      // Register this channel's dispatcher so other channels can route to it
      registerChannel(this.config.channelId, this.dispatcher);
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      unregisterChannel(this.config.channelId);
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      unregisterChannel(this.config.channelId);
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      unregisterChannel(this.config.channelId);
      this.dispatcher = null;
    });
  }
}
