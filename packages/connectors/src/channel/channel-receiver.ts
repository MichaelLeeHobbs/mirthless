import { tryCatch, type Result } from '@galvanigraph/core-util';
import type { SourceConnectorRuntime, MessageDispatcher } from '../base.js';
import { registerChannel, unregisterChannel } from './channel-registry.js';

export interface ChannelReceiverConfig {
  readonly channelId: string;
}

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
