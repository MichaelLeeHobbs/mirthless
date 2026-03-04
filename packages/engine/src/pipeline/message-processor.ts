// ===========================================
// Message Processor — 8-Stage Pipeline
// ===========================================
// Orchestrates message flow: receive → preprocess → filter → transform →
// route to destinations → postprocess → mark processed.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { SandboxExecutor, CompiledScript, ExecutionOptions, ExecutionResult } from '../sandbox/sandbox-executor.js';
import type { SandboxContext } from '../sandbox/sandbox-context.js';
import { createSandboxContext } from '../sandbox/sandbox-context.js';
import type { GlobalChannelMap } from '../runtime/global-channel-map.js';
import type { GlobalMapProxy } from '../runtime/global-map-proxy.js';
import type { AttachmentConfig } from './attachment-handler.js';
import { DestinationSet, createDestinationSetProxy } from './destination-set.js';

// ----- Types -----

/** Compiled scripts for a channel, set at deploy time. */
export interface ChannelScripts {
  readonly preprocessor?: CompiledScript;
  readonly postprocessor?: CompiledScript;
  readonly sourceFilter?: CompiledScript;
  readonly sourceTransformer?: CompiledScript;
  readonly globalPreprocessor?: CompiledScript;
  readonly globalPostprocessor?: CompiledScript;
  readonly deploy?: CompiledScript;
  readonly undeploy?: CompiledScript;
  readonly globalDeploy?: CompiledScript;
  readonly globalUndeploy?: CompiledScript;
}

/** Compiled scripts for a destination. */
export interface DestinationScripts {
  readonly filter?: CompiledScript;
  readonly transformer?: CompiledScript;
  readonly responseTransformer?: CompiledScript;
}

/** Configuration for a single destination in the pipeline. */
export interface DestinationConfig {
  readonly metaDataId: number;
  readonly name: string;
  readonly enabled: boolean;
  readonly scripts: DestinationScripts;
  readonly queueEnabled: boolean;
}

/** Callback to send a message to a destination connector. */
export type SendToDestination = (
  metaDataId: number,
  content: string,
  signal: AbortSignal,
) => Promise<Result<DestinationResponse>>;

/** Response from a destination send. */
export interface DestinationResponse {
  readonly status: 'SENT' | 'ERROR';
  readonly content: string;
  readonly errorMessage?: string;
}

/** Callback to persist message data. */
export interface MessageStore {
  createMessage(channelId: string, serverId: string): Promise<Result<{ messageId: number }>>;
  createConnectorMessage(channelId: string, messageId: number, metaDataId: number, name: string, status: string): Promise<Result<void>>;
  updateConnectorMessageStatus(channelId: string, messageId: number, metaDataId: number, status: string, errorCode?: number): Promise<Result<void>>;
  storeContent(channelId: string, messageId: number, metaDataId: number, contentType: number, content: string, dataType: string): Promise<Result<void>>;
  markProcessed(channelId: string, messageId: number): Promise<Result<void>>;
  enqueue(channelId: string, messageId: number, metaDataId: number): Promise<Result<void>>;
  loadContent(channelId: string, messageId: number, metaDataId: number, contentType: number): Promise<Result<string | null>>;
  dequeue(channelId: string, metaDataId: number, batchSize: number): Promise<Result<readonly unknown[]>>;
  release(channelId: string, messageId: number, metaDataId: number, newStatus: string): Promise<Result<void>>;
  incrementStats(channelId: string, metaDataId: number, serverId: string, field: 'received' | 'filtered' | 'sent' | 'errored'): Promise<Result<void>>;
  storeAttachment?(channelId: string, messageId: number, attachmentId: string, mimeType: string, content: string, size: number): Promise<Result<void>>;
}

/** Input to the pipeline. */
export interface PipelineInput {
  readonly rawContent: string;
  readonly sourceMap: Readonly<Record<string, unknown>>;
}

/** Result of processing a message. */
export interface ProcessedMessage {
  readonly messageId: number;
  readonly status: 'SENT' | 'FILTERED' | 'ERROR';
  readonly response?: string;
  readonly destinationResults: readonly DestinationResult[];
}

/** Result of sending to one destination. */
export interface DestinationResult {
  readonly metaDataId: number;
  readonly status: 'SENT' | 'FILTERED' | 'QUEUED' | 'ERROR';
  readonly response?: string;
}

/** Callback to notify the alert system of pipeline errors. */
export type AlertEventHandler = (event: {
  readonly channelId: string;
  readonly errorType: string;
  readonly errorMessage: string;
  readonly timestamp: number;
}) => Promise<void>;

/** Pipeline configuration. */
export interface PipelineConfig {
  readonly channelId: string;
  readonly serverId: string;
  readonly dataType: string;
  readonly scripts: ChannelScripts;
  readonly destinations: readonly DestinationConfig[];
  readonly scriptTimeoutMs?: number | undefined;
  readonly globalChannelMap?: GlobalChannelMap | undefined;
  readonly globalMapProxy?: GlobalMapProxy | undefined;
  readonly configMap?: Readonly<Record<string, unknown>> | undefined;
  readonly onError?: AlertEventHandler | undefined;
  readonly attachmentConfig?: AttachmentConfig | undefined;
}

/** Mutable map state carried across pipeline stages. */
interface PipelineMapState {
  channelMap: Record<string, unknown>;
  responseMap: Record<string, unknown>;
}

// ----- Content Type Constants (duplicated to avoid cross-package import) -----

const CT_RAW = 1;
const CT_TRANSFORMED = 3;
const CT_SENT = 5;
const CT_RESPONSE = 6;
const CT_RESPONSE_TRANSFORMED = 7;
const CT_SOURCE_MAP = 9;

// ----- Pipeline -----

export class MessageProcessor {
  private readonly sandbox: SandboxExecutor;
  private readonly store: MessageStore;
  private readonly sendFn: SendToDestination;
  private readonly config: PipelineConfig;
  private readonly execOptions: ExecutionOptions;

  constructor(
    sandbox: SandboxExecutor,
    store: MessageStore,
    sendFn: SendToDestination,
    config: PipelineConfig,
    execOptions: ExecutionOptions,
  ) {
    this.sandbox = sandbox;
    this.store = store;
    this.sendFn = sendFn;
    this.config = config;
    // Use per-channel scriptTimeoutMs if configured, otherwise fall back to execOptions
    this.execOptions = config.scriptTimeoutMs
      ? { ...execOptions, timeout: config.scriptTimeoutMs }
      : execOptions;
  }

  /** Process an inbound message through the 8-stage pipeline. */
  async processMessage(
    input: PipelineInput,
    signal: AbortSignal,
  ): Promise<Result<ProcessedMessage>> {
    return tryCatch(async () => {
      const { channelId, serverId, dataType } = this.config;

      // Initialize map state that persists across pipeline stages
      const mapState: PipelineMapState = {
        channelMap: {},
        responseMap: {},
      };

      // Stage 1: Create message in DB
      const createResult = await this.store.createMessage(channelId, serverId);
      if (!createResult.ok) throw new Error('Failed to create message');
      const { messageId } = createResult.value;

      // Create source connector message (metaDataId=0)
      await this.store.createConnectorMessage(channelId, messageId, 0, 'Source', 'RECEIVED');
      await this.store.storeContent(channelId, messageId, 0, CT_RAW, input.rawContent, dataType);
      await this.store.storeContent(channelId, messageId, 0, CT_SOURCE_MAP, JSON.stringify(input.sourceMap), 'JSON');
      await this.store.incrementStats(channelId, 0, serverId, 'received');

      let content = input.rawContent;

      // Stage 2a: Global preprocessor
      if (this.config.scripts.globalPreprocessor) {
        const gpreResult = await this.runScript(
          this.config.scripts.globalPreprocessor, content, input, signal, mapState,
        );
        if (gpreResult.ok && typeof gpreResult.value.returnValue === 'string') {
          content = gpreResult.value.returnValue;
        }
      }

      // Stage 2b: Channel preprocessor
      if (this.config.scripts.preprocessor) {
        const preResult = await this.runScript(
          this.config.scripts.preprocessor, content, input, signal, mapState,
        );
        if (preResult.ok && typeof preResult.value.returnValue === 'string') {
          content = preResult.value.returnValue;
        }
      }

      // Create destination set for source filter/transformer to control routing
      const enabledDests = this.config.destinations.filter((d) => d.enabled);
      const destSet = new DestinationSet(
        enabledDests.map((d) => ({ name: d.name, metaDataId: d.metaDataId })),
      );
      const destSetExtras = { destinationSet: createDestinationSetProxy(destSet) };

      // Stage 3: Source filter
      if (this.config.scripts.sourceFilter) {
        const filterResult = await this.runScript(
          this.config.scripts.sourceFilter, content, input, signal, mapState, destSetExtras,
        );
        if (filterResult.ok && filterResult.value.returnValue === false) {
          await this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'FILTERED');
          await this.store.incrementStats(channelId, 0, serverId, 'filtered');
          await this.store.markProcessed(channelId, messageId);
          return { messageId, status: 'FILTERED' as const, destinationResults: [] } satisfies ProcessedMessage;
        }
      }

      // Stage 4: Source transformer
      if (this.config.scripts.sourceTransformer) {
        const txResult = await this.runScript(
          this.config.scripts.sourceTransformer, content, input, signal, mapState, destSetExtras,
        );
        if (txResult.ok && typeof txResult.value.returnValue === 'string') {
          content = txResult.value.returnValue;
          await this.store.storeContent(channelId, messageId, 0, CT_TRANSFORMED, content, dataType);
        }
      }

      await this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'TRANSFORMED');

      // Stage 5+6: Route to destinations (filtered by destinationSet)
      const activeIds = destSet.getActiveMetaDataIds();
      const destResults = await this.routeToDestinations(
        messageId, content, input, signal, mapState, activeIds,
      );

      // Stage 7a: Channel postprocessor (receives responseMap populated with dest responses)
      if (this.config.scripts.postprocessor) {
        await this.runScript(
          this.config.scripts.postprocessor, content, input, signal, mapState,
        );
      }

      // Stage 7b: Global postprocessor
      if (this.config.scripts.globalPostprocessor) {
        await this.runScript(
          this.config.scripts.globalPostprocessor, content, input, signal, mapState,
        );
      }

      // Stage 8: Mark processed
      await this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'SENT');
      await this.store.incrementStats(channelId, 0, serverId, 'sent');
      await this.store.markProcessed(channelId, messageId);

      const hasError = destResults.some((r) => r.status === 'ERROR');

      // Notify alert system of errors
      if (hasError && this.config.onError) {
        await this.config.onError({
          channelId,
          errorType: 'DESTINATION_CONNECTOR',
          errorMessage: `Destination error in message ${String(messageId)}`,
          timestamp: Date.now(),
        });
      }

      const firstResponse = destResults.find((r) => r.response)?.response;
      const result: ProcessedMessage = {
        messageId,
        status: hasError ? 'ERROR' as const : 'SENT' as const,
        destinationResults: destResults,
      };
      if (firstResponse) {
        return { ...result, response: firstResponse };
      }
      return result;
    });
  }

  /** Route message to active destinations. */
  private async routeToDestinations(
    messageId: number,
    content: string,
    input: PipelineInput,
    signal: AbortSignal,
    mapState: PipelineMapState,
    activeDestinations?: ReadonlySet<number> | undefined,
  ): Promise<readonly DestinationResult[]> {
    const { channelId, serverId, dataType } = this.config;
    const results: DestinationResult[] = [];

    // Process destinations in parallel, filtered by active set
    const promises = this.config.destinations
      .filter((d) => d.enabled && (!activeDestinations || activeDestinations.has(d.metaDataId)))
      .map(async (dest): Promise<DestinationResult> => {
        await this.store.createConnectorMessage(
          channelId, messageId, dest.metaDataId, dest.name, 'RECEIVED',
        );

        let destContent = content;

        // Destination filter — fresh connectorMap per destination
        if (dest.scripts.filter) {
          const filterResult = await this.runScript(
            dest.scripts.filter, destContent, input, signal, mapState,
          );
          if (filterResult.ok && filterResult.value.returnValue === false) {
            await this.store.updateConnectorMessageStatus(
              channelId, messageId, dest.metaDataId, 'FILTERED',
            );
            await this.store.incrementStats(channelId, dest.metaDataId, serverId, 'filtered');
            return { metaDataId: dest.metaDataId, status: 'FILTERED' as const };
          }
        }

        // Destination transformer
        if (dest.scripts.transformer) {
          const txResult = await this.runScript(
            dest.scripts.transformer, destContent, input, signal, mapState,
          );
          if (txResult.ok && typeof txResult.value.returnValue === 'string') {
            destContent = txResult.value.returnValue;
          }
        }

        await this.store.storeContent(
          channelId, messageId, dest.metaDataId, CT_SENT, destContent, dataType,
        );

        // Queue or send directly
        if (dest.queueEnabled) {
          await this.store.enqueue(channelId, messageId, dest.metaDataId);
          return { metaDataId: dest.metaDataId, status: 'QUEUED' as const };
        }

        // Send to destination
        const sendResult = await this.sendFn(dest.metaDataId, destContent, signal);

        if (!sendResult.ok) {
          await this.store.updateConnectorMessageStatus(
            channelId, messageId, dest.metaDataId, 'ERROR',
          );
          await this.store.incrementStats(channelId, dest.metaDataId, serverId, 'errored');
          return { metaDataId: dest.metaDataId, status: 'ERROR' as const };
        }

        const response = sendResult.value;

        if (response.status === 'SENT') {
          await this.store.storeContent(
            channelId, messageId, dest.metaDataId, CT_RESPONSE, response.content, dataType,
          );

          // Populate responseMap with destination response
          mapState.responseMap[dest.name] = { status: response.status, content: response.content };

          // Response transformer (if configured)
          let responseContent = response.content;
          if (dest.scripts.responseTransformer) {
            const rtResult = await this.runScript(
              dest.scripts.responseTransformer, response.content, input, signal, mapState,
            );
            if (rtResult.ok && typeof rtResult.value.returnValue === 'string') {
              responseContent = rtResult.value.returnValue;
              await this.store.storeContent(
                channelId, messageId, dest.metaDataId, CT_RESPONSE_TRANSFORMED, responseContent, dataType,
              );
            }
          }

          await this.store.updateConnectorMessageStatus(
            channelId, messageId, dest.metaDataId, 'SENT',
          );
          await this.store.incrementStats(channelId, dest.metaDataId, serverId, 'sent');
          return {
            metaDataId: dest.metaDataId,
            status: 'SENT' as const,
            response: responseContent,
          };
        }

        await this.store.updateConnectorMessageStatus(
          channelId, messageId, dest.metaDataId, 'ERROR',
        );
        await this.store.incrementStats(channelId, dest.metaDataId, serverId, 'errored');
        return { metaDataId: dest.metaDataId, status: 'ERROR' as const };
      });

    const settled = await Promise.all(promises);
    results.push(...settled);
    return results;
  }

  /** Run a script in the sandbox with the current message context and map state. */
  private async runScript(
    script: CompiledScript,
    content: string,
    input: PipelineInput,
    signal: AbortSignal,
    mapState: PipelineMapState,
    extras?: Readonly<Record<string, unknown>> | undefined,
  ): Promise<Result<ExecutionResult>> {
    const base = createSandboxContext(content, input.rawContent, content);
    const gcm = this.config.globalChannelMap;
    const globalMapProxy = this.config.globalMapProxy;
    const context: SandboxContext = {
      ...base,
      channelMap: { ...mapState.channelMap },
      responseMap: { ...mapState.responseMap },
      sourceMap: input.sourceMap,
      ...(gcm ? { globalChannelMap: gcm.toRecord() } : {}),
      ...(globalMapProxy ? { globalMap: globalMapProxy.toRecord() } : {}),
      ...(this.config.configMap ? { configMap: this.config.configMap } : {}),
      ...(extras ? { extras } : {}),
    };
    const result = await this.sandbox.execute(script, context, { ...this.execOptions, signal });
    if (result.ok) {
      // Merge map updates back into pipeline state
      Object.assign(mapState.channelMap, result.value.mapUpdates.channelMap);
      if (gcm) {
        gcm.applyUpdates(result.value.mapUpdates.globalChannelMap);
      }
      if (globalMapProxy) {
        globalMapProxy.applyUpdates(result.value.mapUpdates.globalMap);
      }
    }
    return result;
  }
}
