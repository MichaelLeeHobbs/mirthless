import { AsyncLocalStorage } from 'node:async_hooks';
import { fillPlaceholders, recordLookup, tryCatch, type Result } from '@galvanigraph/core-util';
import { DISPATCH_STATUS, variableNames, type DestinationConnectorRuntime, type ConnectorMessage, type ConnectorResponse } from '../base.js';
import { getChannelDispatcher, hasChannel } from './channel-registry.js';

export interface ChannelDispatcherConfig {
  readonly targetChannelId: string;
  readonly waitForResponse: boolean;
}

/**
 * Without a cap, A routing to B routing back to A recurses in memory until the process dies.
 * AsyncLocalStorage keeps the depth per message across the awaited chain.
 */
const MAX_CHANNEL_HOPS = 10;
const hopDepth = new AsyncLocalStorage<number>();

/** By the shared placeholder rule (D-275); an unknown name is left as written. */
export function resolveTarget(target: string, variables: Readonly<Record<string, unknown>> | undefined): string {
  return fillPlaceholders(target, recordLookup(variables ?? {}));
}

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

  variablesUsed(): readonly string[] {
    return variableNames([this.config.targetChannelId]);
  }

  /** The target may be `${name}`, filled per message, so a router picks the channel at run time (Mirth's `${destinationChannelId}`). */
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

      const target = resolveTarget(this.config.targetChannelId, message.variables);
      if (target.includes('${')) {
        return {
          status: 'ERROR' as const,
          content: '',
          errorMessage: `Target channel ${this.config.targetChannelId} names a variable this message does not have`,
        };
      }
      const dispatcher = getChannelDispatcher(target);
      if (!dispatcher) {
        return {
          status: 'ERROR' as const,
          content: '',
          errorMessage: `Target channel ${target} is not deployed or not registered`,
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

      // The target took the message but recorded it with an error. Reporting
      // SENT here would hide the failure from this channel's status and alerts.
      if (result.value.status === DISPATCH_STATUS.ERROR) {
        return {
          status: 'ERROR' as const,
          content: '',
          errorMessage: `Target channel ${target} recorded message ${String(result.value.messageId)} with an ERROR status`,
        };
      }

      const responseContent = this.config.waitForResponse && result.value.response
        ? result.value.response
        : `messageId=${String(result.value.messageId)}`;

      return { status: 'SENT' as const, content: responseContent };
    });
  }

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
