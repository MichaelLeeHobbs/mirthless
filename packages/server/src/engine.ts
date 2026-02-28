// ===========================================
// Engine Manager
// ===========================================
// Singleton that manages all channel runtimes.
// Bridges the Express server to the engine package.

import {
  ChannelRuntime,
  VmSandboxExecutor,
  MessageProcessor,
  DEFAULT_EXECUTION_OPTIONS,
  compileScript,
  type ChannelRuntimeConfig,
  type PipelineConfig,
  type ChannelScripts,
  type DestinationConfig,
  type SandboxExecutor,
  type MessageStore,
  type SendToDestination,
} from '@mirthless/engine';
import { tryCatch } from 'stderr-lib';
import {
  createSourceConnector,
  createDestinationConnector,
  type SourceConnectorRuntime,
  type DestinationConnectorRuntime,
} from '@mirthless/connectors';
import { MessageService } from './services/message.service.js';
import type { ChannelDetail } from './services/channel.service.js';

// ----- Types -----

export interface DeployedChannel {
  readonly channelId: string;
  readonly runtime: ChannelRuntime;
  readonly config: ChannelDetail;
}

// ----- Message Store Adapter -----

/** Adapts MessageService (static methods) to the MessageStore interface. */
function createMessageStoreAdapter(): MessageStore {
  return {
    createMessage: (channelId, serverId) =>
      MessageService.createMessage(channelId, serverId),
    createConnectorMessage: (channelId, messageId, metaDataId, name, status) =>
      MessageService.createConnectorMessage(channelId, messageId, metaDataId, name, status as Parameters<typeof MessageService.createConnectorMessage>[4]),
    updateConnectorMessageStatus: (channelId, messageId, metaDataId, status, errorCode) =>
      MessageService.updateConnectorMessageStatus(channelId, messageId, metaDataId, status as Parameters<typeof MessageService.updateConnectorMessageStatus>[3], errorCode),
    storeContent: (channelId, messageId, metaDataId, contentType, content, dataType) =>
      MessageService.storeContent(channelId, messageId, metaDataId, contentType as Parameters<typeof MessageService.storeContent>[3], content, dataType),
    markProcessed: (channelId, messageId) =>
      MessageService.markProcessed(channelId, messageId),
    enqueue: (channelId, messageId, metaDataId) =>
      MessageService.enqueue(channelId, messageId, metaDataId),
    incrementStats: (channelId, metaDataId, serverId, field) =>
      MessageService.incrementStats(channelId, metaDataId, serverId, field),
    dequeue: (channelId, metaDataId, batchSize) =>
      MessageService.dequeue(channelId, metaDataId, batchSize),
    release: (channelId, messageId, metaDataId, newStatus) =>
      MessageService.release(channelId, messageId, metaDataId, newStatus as Parameters<typeof MessageService.release>[3]),
  };
}

// ----- Engine Manager -----

export class EngineManager {
  private readonly runtimes = new Map<string, DeployedChannel>();
  private readonly sandbox: SandboxExecutor;
  private readonly store: MessageStore;
  private readonly serverId: string;

  constructor(serverId?: string) {
    this.sandbox = new VmSandboxExecutor();
    this.store = createMessageStoreAdapter();
    this.serverId = serverId ?? 'server-01';
  }

  /** Deploy a channel from its stored configuration. */
  async deploy(channel: ChannelDetail): Promise<void> {
    if (this.runtimes.has(channel.id)) {
      throw new Error(`Channel ${channel.id} is already deployed`);
    }

    const runtime = new ChannelRuntime();

    // Create source connector
    const source = createSourceConnector(
      channel.sourceConnectorType,
      channel.sourceConnectorProperties,
    ) as SourceConnectorRuntime;

    // Create destination connectors
    const destinations = new Map<number, DestinationConnectorRuntime>();
    for (const dest of channel.destinations) {
      const connector = createDestinationConnector(
        dest.connectorType,
        dest.properties,
      );
      destinations.set(dest.metaDataId, connector);
    }

    // Compile channel scripts
    const scripts = await this.compileChannelScripts(channel);

    // Build destination configs
    const destConfigs: DestinationConfig[] = channel.destinations.map((d) => ({
      metaDataId: d.metaDataId,
      name: d.name,
      enabled: d.enabled,
      scripts: {},
      queueEnabled: d.queueMode !== 'NEVER',
    }));

    // Build pipeline config
    const pipelineConfig: PipelineConfig = {
      channelId: channel.id,
      serverId: this.serverId,
      dataType: channel.inboundDataType,
      scripts,
      destinations: destConfigs,
    };

    // Build send function
    const sendFn: SendToDestination = async (metaDataId, content, signal) => {
      const connector = destinations.get(metaDataId);
      if (!connector) {
        return tryCatch(() => { throw new Error(`Destination ${String(metaDataId)} not found`); });
      }
      return connector.send({ channelId: channel.id, messageId: 0, metaDataId, content, dataType: channel.inboundDataType }, signal);
    };

    // Create message processor
    const processor = new MessageProcessor(
      this.sandbox, this.store, sendFn, pipelineConfig, DEFAULT_EXECUTION_OPTIONS,
    );

    // Build runtime config
    const runtimeConfig: ChannelRuntimeConfig = {
      channelId: channel.id,
      source,
      destinations,
      onMessage: async (raw) => processor.processMessage(
        { rawContent: raw.content, sourceMap: raw.sourceMap },
        AbortSignal.timeout(30_000),
      ),
    };

    const result = await runtime.deploy(runtimeConfig);
    if (!result.ok) {
      throw new Error('Failed to deploy channel runtime');
    }

    this.runtimes.set(channel.id, { channelId: channel.id, runtime, config: channel });
  }

  /** Get a deployed channel runtime. */
  getRuntime(channelId: string): DeployedChannel | undefined {
    return this.runtimes.get(channelId);
  }

  /** Get all deployed channel runtimes. */
  getAll(): ReadonlyMap<string, DeployedChannel> {
    return this.runtimes;
  }

  /** Undeploy a channel and remove it from management. */
  async undeploy(channelId: string): Promise<void> {
    const deployed = this.runtimes.get(channelId);
    if (!deployed) {
      throw new Error(`Channel ${channelId} is not deployed`);
    }

    const result = await deployed.runtime.undeploy();
    if (!result.ok) {
      throw new Error('Failed to undeploy channel runtime');
    }

    this.runtimes.delete(channelId);
  }

  /** Compile channel scripts from the stored configuration. */
  private async compileChannelScripts(channel: ChannelDetail): Promise<ChannelScripts> {
    const scripts: Record<string, unknown> = {};

    for (const script of channel.scripts) {
      if (!script.script) continue;

      const result = await compileScript(script.script, {
        sourcefile: `${channel.name}/${script.scriptType.toLowerCase()}.ts`,
      });

      if (result.ok) {
        const key = script.scriptType.toLowerCase();
        if (key === 'preprocessor') scripts['preprocessor'] = result.value;
        if (key === 'postprocessor') scripts['postprocessor'] = result.value;
      }
    }

    return scripts as ChannelScripts;
  }

  /** Dispose all resources. */
  dispose(): void {
    this.sandbox.dispose();
  }
}

// ----- Singleton -----

let engineInstance: EngineManager | null = null;

/** Get or create the engine manager singleton. */
export function getEngine(): EngineManager {
  if (!engineInstance) {
    engineInstance = new EngineManager();
  }
  return engineInstance;
}
