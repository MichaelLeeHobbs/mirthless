// ===========================================
// Message Processor — 8-Stage Pipeline
// ===========================================
// Orchestrates message flow: receive → preprocess → filter → transform →
// route to destinations → postprocess → mark processed.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { SandboxExecutor, CompiledScript, ExecutionOptions, ExecutionResult } from '../sandbox/sandbox-executor.js';
import { createSandboxContext } from '../sandbox/sandbox-context.js';

// ----- Types -----

/** Compiled scripts for a channel, set at deploy time. */
export interface ChannelScripts {
  readonly preprocessor?: CompiledScript;
  readonly postprocessor?: CompiledScript;
  readonly sourceFilter?: CompiledScript;
  readonly sourceTransformer?: CompiledScript;
}

/** Compiled scripts for a destination. */
export interface DestinationScripts {
  readonly filter?: CompiledScript;
  readonly transformer?: CompiledScript;
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
  dequeue(channelId: string, metaDataId: number, batchSize: number): Promise<Result<readonly unknown[]>>;
  release(channelId: string, messageId: number, metaDataId: number, newStatus: string): Promise<Result<void>>;
  incrementStats(channelId: string, metaDataId: number, serverId: string, field: 'received' | 'filtered' | 'sent' | 'errored'): Promise<Result<void>>;
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

/** Pipeline configuration. */
export interface PipelineConfig {
  readonly channelId: string;
  readonly serverId: string;
  readonly dataType: string;
  readonly scripts: ChannelScripts;
  readonly destinations: readonly DestinationConfig[];
}

// ----- Content Type Constants (duplicated to avoid cross-package import) -----

const CT_RAW = 1;
const CT_TRANSFORMED = 3;
const CT_SENT = 5;
const CT_RESPONSE = 6;

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
    this.execOptions = execOptions;
  }

  /** Process an inbound message through the 8-stage pipeline. */
  async processMessage(
    input: PipelineInput,
    signal: AbortSignal,
  ): Promise<Result<ProcessedMessage>> {
    return tryCatch(async () => {
      const { channelId, serverId, dataType } = this.config;

      // Stage 1: Create message in DB
      const createResult = await this.store.createMessage(channelId, serverId);
      if (!createResult.ok) throw new Error('Failed to create message');
      const { messageId } = createResult.value;

      // Create source connector message (metaDataId=0)
      await this.store.createConnectorMessage(channelId, messageId, 0, 'Source', 'RECEIVED');
      await this.store.storeContent(channelId, messageId, 0, CT_RAW, input.rawContent, dataType);
      await this.store.incrementStats(channelId, 0, serverId, 'received');

      let content = input.rawContent;

      // Stage 2: Preprocessor
      if (this.config.scripts.preprocessor) {
        const preResult = await this.runScript(
          this.config.scripts.preprocessor, content, input, signal,
        );
        if (preResult.ok && typeof preResult.value.returnValue === 'string') {
          content = preResult.value.returnValue;
        }
      }

      // Stage 3: Source filter
      if (this.config.scripts.sourceFilter) {
        const filterResult = await this.runScript(
          this.config.scripts.sourceFilter, content, input, signal,
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
          this.config.scripts.sourceTransformer, content, input, signal,
        );
        if (txResult.ok && typeof txResult.value.returnValue === 'string') {
          content = txResult.value.returnValue;
          await this.store.storeContent(channelId, messageId, 0, CT_TRANSFORMED, content, dataType);
        }
      }

      await this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'TRANSFORMED');

      // Stage 5+6: Route to destinations
      const destResults = await this.routeToDestinations(
        messageId, content, input, signal,
      );

      // Stage 7: Postprocessor
      if (this.config.scripts.postprocessor) {
        await this.runScript(
          this.config.scripts.postprocessor, content, input, signal,
        );
      }

      // Stage 8: Mark processed
      await this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'SENT');
      await this.store.incrementStats(channelId, 0, serverId, 'sent');
      await this.store.markProcessed(channelId, messageId);

      const hasError = destResults.some((r) => r.status === 'ERROR');
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

  /** Route message to all enabled destinations. */
  private async routeToDestinations(
    messageId: number,
    content: string,
    input: PipelineInput,
    signal: AbortSignal,
  ): Promise<readonly DestinationResult[]> {
    const { channelId, serverId, dataType } = this.config;
    const results: DestinationResult[] = [];

    // Process destinations in parallel
    const promises = this.config.destinations
      .filter((d) => d.enabled)
      .map(async (dest): Promise<DestinationResult> => {
        await this.store.createConnectorMessage(
          channelId, messageId, dest.metaDataId, dest.name, 'RECEIVED',
        );

        let destContent = content;

        // Destination filter
        if (dest.scripts.filter) {
          const filterResult = await this.runScript(
            dest.scripts.filter, destContent, input, signal,
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
            dest.scripts.transformer, destContent, input, signal,
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
          await this.store.updateConnectorMessageStatus(
            channelId, messageId, dest.metaDataId, 'SENT',
          );
          await this.store.incrementStats(channelId, dest.metaDataId, serverId, 'sent');
          return {
            metaDataId: dest.metaDataId,
            status: 'SENT' as const,
            response: response.content,
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

  /** Run a script in the sandbox with the current message context. */
  private async runScript(
    script: CompiledScript,
    content: string,
    input: PipelineInput,
    signal: AbortSignal,
  ): Promise<Result<ExecutionResult>> {
    const context = createSandboxContext(content, input.rawContent, content);
    return this.sandbox.execute(script, context, { ...this.execOptions, signal });
  }
}
