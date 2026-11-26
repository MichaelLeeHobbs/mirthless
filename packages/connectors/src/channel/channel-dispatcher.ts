import { AsyncLocalStorage } from 'node:async_hooks';
import { fillPlaceholders, recordLookup, tryCatch, type Result } from '@galvanigraph/core-util';
import { DISPATCH_STATUS, variableNames, type DestinationConnectorRuntime, type ConnectorMessage, type ConnectorResponse, type DispatchResult } from '../base.js';
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

/**
 * A target that recorded the message with an error, reported or hidden by its response mode, is an
 * ERROR here: SENT would hide the failure from this channel's status and alerts. The target keeps the
 * message, where it can be reprocessed, so the ERROR is final: a resend would be a second message there (D-393).
 */
function handedOff(target: string, result: DispatchResult, waitForResponse: boolean): ConnectorResponse {
  const id = String(result.messageId);
  if (result.status === DISPATCH_STATUS.ERROR) {
    return { status: 'ERROR', content: '', errorMessage: `Target channel ${target} recorded message ${id} with an ERROR status`, final: true };
  }
  if (result.destinationFailed === true) {
    return {
      status: 'ERROR',
      content: waitForResponse ? result.response ?? '' : '',
      errorMessage: `Target channel ${target} recorded message ${id} with an error that its response mode does not report`,
      final: true,
    };
  }
  return { status: 'SENT', content: waitForResponse && result.response ? result.response : `messageId=${id}` };
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

      return handedOff(target, result.value, this.config.waitForResponse);
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
