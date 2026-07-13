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
import { parseForSandbox, serializeFromSandbox } from './data-type-handler.js';

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
  /**
   * NEVER — send directly, mark ERROR on failure.
   * ALWAYS — always enqueue (the queue consumer delivers + retries).
   * ON_FAILURE — try a direct send; only enqueue for retry if that send fails.
   */
  readonly queueMode: 'NEVER' | 'ON_FAILURE' | 'ALWAYS';
}

/** Callback to send a message to a destination connector. */
export type SendToDestination = (
  metaDataId: number,
  messageId: number,
  content: string,
  signal: AbortSignal,
  correlationId?: string,
) => Promise<Result<DestinationResponse>>;

/** Response from a destination send. */
export interface DestinationResponse {
  readonly status: 'SENT' | 'ERROR';
  readonly content: string;
  readonly errorMessage?: string;
}

/** A content row to insert in a batch. */
export interface ContentRow {
  readonly metaDataId: number;
  readonly contentType: number;
  readonly content: string;
  readonly dataType: string;
}

/** Callback to persist message data. */
export interface MessageStore {
  createMessage(channelId: string, serverId: string, correlationId?: string): Promise<Result<{ messageId: number; correlationId: string }>>;
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

  /**
   * Optional batch: creates message + source connector + content rows + stats in one round-trip.
   * Implementations that don't provide this fall back to individual calls.
   */
  initializeMessage?(
    channelId: string, serverId: string, connectorName: string,
    contentRows: readonly ContentRow[], correlationId?: string,
  ): Promise<Result<{ messageId: number; correlationId: string }>>;

  /**
   * Optional batch: sets source connector status to SENT, increments sent stat, marks processed — one round-trip.
   */
  finalizeMessage?(
    channelId: string, messageId: number, serverId: string,
  ): Promise<Result<void>>;

  /**
   * Optional: apply the channel's removeContentOnCompletion / removeAttachmentsOnCompletion
   * policy for a message that has fully and successfully completed. The pipeline only
   * calls this when there are no errored or still-queued destinations, so it never
   * races the queue consumer or destroys content needed to investigate a failure.
   */
  removeCompletedContent?(channelId: string, messageId: number): Promise<Result<void>>;
}

/** Input to the pipeline. */
export interface PipelineInput {
  readonly rawContent: string;
  readonly sourceMap: Readonly<Record<string, unknown>>;
  /** Cross-channel correlation ID. If provided, reuses an existing correlation chain. */
  readonly correlationId?: string | undefined;
}

/** Result of processing a message. */
export interface ProcessedMessage {
  readonly messageId: number;
  readonly correlationId: string;
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

/** Stage timing entry emitted by the pipeline. */
export interface StageTiming {
  readonly stage: string;
  readonly durationMs: number;
}

/** Callback for pipeline debug timing. Called once per message with all stage timings. */
export type TimingCallback = (messageId: number, totalMs: number, stages: readonly StageTiming[]) => void;

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
  readonly onTiming?: TimingCallback | undefined;
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
const CT_PROCESSING_ERROR = 13;

/**
 * Resolve a preprocessor's replacement message. A preprocessor returns the new
 * message content; a boolean return (e.g. the filter-style `return true`) is a
 * common mistake that must NOT overwrite the message with the string "true".
 * Boolean returns fall back to the (possibly mutated) `msg` variable.
 */
function preprocessorReplacement(returnValue: unknown, msg: unknown): unknown {
  if (returnValue != null && typeof returnValue !== 'boolean') return returnValue;
  return msg;
}

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
      const timing = this.config.onTiming;

      // Lightweight timing tracker — zero overhead when onTiming is not set
      const stages: StageTiming[] = [];
      let lastMark = timing ? performance.now() : 0;
      const mark = (stage: string): void => {
        if (!timing) return;
        const now = performance.now();
        stages.push({ stage, durationMs: Math.round((now - lastMark) * 100) / 100 });
        lastMark = now;
      };

      // Initialize map state that persists across pipeline stages
      const mapState: PipelineMapState = {
        channelMap: {},
        responseMap: {},
      };

      // Stage 1: Create message + source connector + raw content + stats
      let messageId: number;
      let correlationId: string;
      if (this.store.initializeMessage) {
        const initResult = await this.store.initializeMessage(channelId, serverId, 'Source', [
          { metaDataId: 0, contentType: CT_RAW, content: input.rawContent, dataType },
          { metaDataId: 0, contentType: CT_SOURCE_MAP, content: JSON.stringify(input.sourceMap), dataType: 'JSON' },
        ], input.correlationId);
        if (!initResult.ok) throw new Error('Failed to initialize message');
        messageId = initResult.value.messageId;
        correlationId = initResult.value.correlationId;
      } else {
        const createResult = await this.store.createMessage(channelId, serverId, input.correlationId);
        if (!createResult.ok) throw new Error('Failed to create message');
        messageId = createResult.value.messageId;
        correlationId = createResult.value.correlationId;
        await Promise.all([
          this.store.createConnectorMessage(channelId, messageId, 0, 'Source', 'RECEIVED'),
          this.store.storeContent(channelId, messageId, 0, CT_RAW, input.rawContent, dataType),
          this.store.storeContent(channelId, messageId, 0, CT_SOURCE_MAP, JSON.stringify(input.sourceMap), 'JSON'),
          this.store.incrementStats(channelId, 0, serverId, 'received'),
        ]);
      }
      mark('initialize');

      let content = input.rawContent;

      // Validate inbound data type — parse to verify format is valid
      try {
        parseForSandbox(content, dataType);
      } catch (parseErr) {
        const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        // Use inline error-out since errorOut helper isn't defined yet
        await Promise.all([
          this.store.storeContent(channelId, messageId, 0, CT_PROCESSING_ERROR, `Invalid ${dataType}: ${parseMsg}`, 'TEXT'),
          this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'ERROR'),
          this.store.incrementStats(channelId, 0, serverId, 'errored'),
          this.store.markProcessed(channelId, messageId),
        ]);
        mark('parseInbound');
        if (this.config.onError) {
          await this.config.onError({
            channelId, errorType: 'SOURCE_CONNECTOR',
            errorMessage: `Invalid ${dataType}: ${parseMsg}`, timestamp: Date.now(),
          });
        }
        if (timing) timing(messageId, stages.reduce((s, t) => s + t.durationMs, 0), stages);
        return { messageId, correlationId, status: 'ERROR' as const, destinationResults: [] };
      }

      // Helper: mark source as errored and return ERROR result
      const errorOut = async (stage: string, errMsg: string): Promise<ProcessedMessage> => {
        await Promise.all([
          this.store.storeContent(channelId, messageId, 0, CT_PROCESSING_ERROR, errMsg, 'TEXT'),
          this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'ERROR'),
          this.store.incrementStats(channelId, 0, serverId, 'errored'),
          this.store.markProcessed(channelId, messageId),
        ]);
        mark(stage);
        if (this.config.onError) {
          await this.config.onError({
            channelId, errorType: 'SOURCE_CONNECTOR',
            errorMessage: `Script error in ${stage}: ${errMsg}`, timestamp: Date.now(),
          });
        }
        if (timing) timing(messageId, stages.reduce((s, t) => s + t.durationMs, 0), stages);
        return { messageId, correlationId, status: 'ERROR' as const, destinationResults: [] };
      };

      // Stage 2a: Global preprocessor
      if (this.config.scripts.globalPreprocessor) {
        const gpreResult = await this.runScript(
          this.config.scripts.globalPreprocessor, content, input, signal, mapState,
        );
        if (!gpreResult.ok) return errorOut('globalPreprocessor', gpreResult.error.message);
        const gpreVal = preprocessorReplacement(gpreResult.value.returnValue, gpreResult.value.msg);
        if (gpreVal != null) {
          content = serializeFromSandbox(gpreVal, dataType);
        }
        mark('globalPreprocessor');
      }

      // Stage 2b: Channel preprocessor
      if (this.config.scripts.preprocessor) {
        const preResult = await this.runScript(
          this.config.scripts.preprocessor, content, input, signal, mapState,
        );
        if (!preResult.ok) return errorOut('preprocessor', preResult.error.message);
        const preVal = preprocessorReplacement(preResult.value.returnValue, preResult.value.msg);
        if (preVal != null) {
          content = serializeFromSandbox(preVal, dataType);
        }
        mark('preprocessor');
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
        if (!filterResult.ok) return errorOut('sourceFilter', filterResult.error.message);
        mark('sourceFilter');
        if (filterResult.value.returnValue === false) {
          await Promise.all([
            this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'FILTERED'),
            this.store.incrementStats(channelId, 0, serverId, 'filtered'),
            this.store.markProcessed(channelId, messageId),
          ]);
          mark('filterFinalize');
          if (timing) timing(messageId, stages.reduce((s, t) => s + t.durationMs, 0), stages);
          return { messageId, correlationId, status: 'FILTERED' as const, destinationResults: [] } satisfies ProcessedMessage;
        }
      }

      // Stage 4: Source transformer
      if (this.config.scripts.sourceTransformer) {
        const txResult = await this.runScript(
          this.config.scripts.sourceTransformer, content, input, signal, mapState, destSetExtras,
        );
        if (!txResult.ok) return errorOut('sourceTransformer', txResult.error.message);
        // Use explicit return value if present, otherwise fall back to msg variable
        const transformed = txResult.value.returnValue ?? txResult.value.msg;
        content = serializeFromSandbox(transformed, dataType);
        mark('sourceTransformer');
      }

      // Store transformed content + update status (parallel)
      await Promise.all([
        this.config.scripts.sourceTransformer
          ? this.store.storeContent(channelId, messageId, 0, CT_TRANSFORMED, content, dataType)
          : Promise.resolve({ ok: true as const, value: undefined, error: null }),
        this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'TRANSFORMED'),
      ]);
      mark('storeTransformed');

      // Stage 5+6: Route to destinations (filtered by destinationSet)
      const activeIds = destSet.getActiveMetaDataIds();
      const destResults = await this.routeToDestinations(
        messageId, content, input, signal, mapState, activeIds, correlationId,
      );
      mark('destinations');

      const destHasError = destResults.some((r) => r.status === 'ERROR');
      let postprocessorFailed = false;

      // Stage 7a: Channel postprocessor (receives responseMap populated with dest responses)
      if (this.config.scripts.postprocessor) {
        const postResult = await this.runScript(
          this.config.scripts.postprocessor, content, input, signal, mapState,
        );
        if (!postResult.ok) {
          postprocessorFailed = true;
          await this.storeAndAlertPostError(messageId, 'postprocessor', postResult.error.message);
        }
        mark('postprocessor');
      }

      // Stage 7b: Global postprocessor
      if (this.config.scripts.globalPostprocessor) {
        const gpostResult = await this.runScript(
          this.config.scripts.globalPostprocessor, content, input, signal, mapState,
        );
        if (!gpostResult.ok) {
          postprocessorFailed = true;
          await this.storeAndAlertPostError(messageId, 'globalPostprocessor', gpostResult.error.message);
        }
        mark('globalPostprocessor');
      }

      const hasError = destHasError || postprocessorFailed;

      // Stage 8: Finalize source connector. Do NOT record the source as SENT when a
      // destination or postprocessor failed — that would overcount throughput and
      // hide failures. Mark the source ERRORed instead so stats stay truthful.
      const hasQueued = destResults.some((r) => r.status === 'QUEUED');
      if (hasError) {
        await Promise.all([
          this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'ERROR'),
          this.store.incrementStats(channelId, 0, serverId, 'errored'),
          this.store.markProcessed(channelId, messageId),
        ]);
      } else if (this.store.finalizeMessage) {
        await this.store.finalizeMessage(channelId, messageId, serverId);
      } else {
        await Promise.all([
          this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'SENT'),
          this.store.incrementStats(channelId, 0, serverId, 'sent'),
          this.store.markProcessed(channelId, messageId),
        ]);
      }

      // Apply removeContentOnCompletion only when the message is fully done — no
      // errors and nothing still queued (a queued destination needs the stored
      // content to deliver later, and error content must be kept for investigation).
      if (!hasError && !hasQueued && this.store.removeCompletedContent) {
        await this.store.removeCompletedContent(channelId, messageId);
      }
      mark('finalize');

      // Emit timing data
      if (timing) {
        timing(messageId, stages.reduce((s, t) => s + t.durationMs, 0), stages);
      }

      // Notify alert system of destination errors
      if (destHasError && this.config.onError) {
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
        correlationId,
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
    correlationId?: string | undefined,
  ): Promise<readonly DestinationResult[]> {
    const { channelId, serverId, dataType } = this.config;
    const results: DestinationResult[] = [];

    // Process destinations in parallel, filtered by active set
    const promises = this.config.destinations
      .filter((d) => d.enabled && (!activeDestinations || activeDestinations.has(d.metaDataId)))
      .map(async (dest): Promise<DestinationResult> => {
        // A persistence failure here must fail the destination loudly (ERROR +
        // alert), never be ignored — otherwise the message is silently lost with
        // no dest row, no recovery, and a SENT source status.
        const createResult = await this.store.createConnectorMessage(
          channelId, messageId, dest.metaDataId, dest.name, 'RECEIVED',
        );
        if (!createResult.ok) {
          return this.destErrorOut(messageId, dest, 'createConnectorMessage', createResult.error.message);
        }

        let destContent = content;

        // Destination filter — fresh connectorMap per destination.
        // A script error must fail the destination loudly, never fall through as
        // if the filter passed (which would send unfiltered PHI downstream).
        if (dest.scripts.filter) {
          const filterResult = await this.runScript(
            dest.scripts.filter, destContent, input, signal, mapState,
          );
          if (!filterResult.ok) {
            return this.destErrorOut(messageId, dest, 'destinationFilter', filterResult.error.message);
          }
          if (filterResult.value.returnValue === false) {
            await Promise.all([
              this.store.updateConnectorMessageStatus(channelId, messageId, dest.metaDataId, 'FILTERED'),
              this.store.incrementStats(channelId, dest.metaDataId, serverId, 'filtered'),
            ]);
            return { metaDataId: dest.metaDataId, status: 'FILTERED' as const };
          }
        }

        // Destination transformer — a script error must fail the destination.
        // Never send untransformed content downstream on a transformer failure.
        if (dest.scripts.transformer) {
          const txResult = await this.runScript(
            dest.scripts.transformer, destContent, input, signal, mapState,
          );
          if (!txResult.ok) {
            return this.destErrorOut(messageId, dest, 'destinationTransformer', txResult.error.message);
          }
          const transformed = txResult.value.returnValue ?? txResult.value.msg;
          destContent = serializeFromSandbox(transformed, dataType);
        }

        // Persist the outbound (SENT) content BEFORE queuing/sending. A queued
        // destination reloads exactly this row to deliver, and crash recovery
        // redispatches from it — if the write fails we must error now (before any
        // send) rather than silently lose the message or deliver un-persisted PHI.
        const storeSentResult = await this.store.storeContent(
          channelId, messageId, dest.metaDataId, CT_SENT, destContent, dataType,
        );
        if (!storeSentResult.ok) {
          return this.destErrorOut(messageId, dest, 'storeSentContent', storeSentResult.error.message);
        }

        // ALWAYS: hand straight to the queue (the consumer delivers + retries).
        if (dest.queueMode === 'ALWAYS') {
          return this.enqueueDestination(messageId, dest);
        }

        // NEVER / ON_FAILURE: attempt a direct send first.
        const sendResult = await this.sendFn(dest.metaDataId, messageId, destContent, signal, correlationId);

        if (!sendResult.ok) {
          // ON_FAILURE: fall back to the queue for retry instead of a hard ERROR.
          if (dest.queueMode === 'ON_FAILURE') {
            return this.enqueueDestination(messageId, dest);
          }
          await Promise.all([
            this.store.updateConnectorMessageStatus(channelId, messageId, dest.metaDataId, 'ERROR'),
            this.store.incrementStats(channelId, dest.metaDataId, serverId, 'errored'),
          ]);
          return { metaDataId: dest.metaDataId, status: 'ERROR' as const };
        }

        const response = sendResult.value;

        if (response.status === 'SENT') {
          await this.store.storeContent(
            channelId, messageId, dest.metaDataId, CT_RESPONSE, response.content, dataType,
          );

          // Populate responseMap with destination response
          mapState.responseMap[dest.name] = { status: response.status, content: response.content };

          // Response transformer (if configured). A script error here must be
          // surfaced loudly (error content + alert), never swallowed — but the
          // message was already delivered to the destination, so we keep the
          // destination SENT and fall back to the untransformed response rather
          // than flip to ERROR (which could trigger a duplicate redelivery).
          let responseContent = response.content;
          if (dest.scripts.responseTransformer) {
            const rtResult = await this.runScript(
              dest.scripts.responseTransformer, response.content, input, signal, mapState,
            );
            if (rtResult.ok) {
              const transformed = rtResult.value.returnValue ?? rtResult.value.msg;
              responseContent = serializeFromSandbox(transformed, dataType);
              await this.store.storeContent(
                channelId, messageId, dest.metaDataId, CT_RESPONSE_TRANSFORMED, responseContent, dataType,
              );
            } else {
              await this.store.storeContent(
                channelId, messageId, dest.metaDataId, CT_PROCESSING_ERROR,
                `Script error in responseTransformer: ${rtResult.error.message}`, 'TEXT',
              );
              if (this.config.onError) {
                await this.config.onError({
                  channelId, errorType: 'DESTINATION_CONNECTOR',
                  errorMessage: `Response transformer error in message ${String(messageId)}: ${rtResult.error.message}`,
                  timestamp: Date.now(),
                });
              }
            }
          }

          await Promise.all([
            this.store.updateConnectorMessageStatus(channelId, messageId, dest.metaDataId, 'SENT'),
            this.store.incrementStats(channelId, dest.metaDataId, serverId, 'sent'),
          ]);
          return {
            metaDataId: dest.metaDataId,
            status: 'SENT' as const,
            response: responseContent,
          };
        }

        // Destination responded but not SENT (e.g. remote NAK). ON_FAILURE queues
        // it for retry; otherwise mark ERROR.
        if (dest.queueMode === 'ON_FAILURE') {
          return this.enqueueDestination(messageId, dest);
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

  /** Enqueue a destination for (retried) delivery by the queue consumer. */
  private async enqueueDestination(
    messageId: number,
    dest: DestinationConfig,
  ): Promise<DestinationResult> {
    const enqueueResult = await this.store.enqueue(this.config.channelId, messageId, dest.metaDataId);
    if (!enqueueResult.ok) {
      // Enqueue failed — the message would otherwise be marked QUEUED but sit
      // undelivered forever (queue consumer never sees it, recovery skips
      // processed rows). Fail loud so it is retried/alerted, not lost.
      return this.destErrorOut(messageId, dest, 'enqueue', enqueueResult.error.message);
    }
    return { metaDataId: dest.metaDataId, status: 'QUEUED' as const };
  }

  /** Mark a destination ERRORed after a filter/transformer script failure (stores error content + errored stat). */
  private async destErrorOut(
    messageId: number,
    dest: DestinationConfig,
    stage: string,
    errMsg: string,
  ): Promise<DestinationResult> {
    const { channelId, serverId } = this.config;
    await Promise.all([
      this.store.storeContent(channelId, messageId, dest.metaDataId, CT_PROCESSING_ERROR, `Script error in ${stage}: ${errMsg}`, 'TEXT'),
      this.store.updateConnectorMessageStatus(channelId, messageId, dest.metaDataId, 'ERROR'),
      this.store.incrementStats(channelId, dest.metaDataId, serverId, 'errored'),
    ]);
    return { metaDataId: dest.metaDataId, status: 'ERROR' as const };
  }

  /** Store a postprocessor script error against the source connector and raise an alert event. */
  private async storeAndAlertPostError(
    messageId: number,
    stage: string,
    errMsg: string,
  ): Promise<void> {
    const { channelId } = this.config;
    await this.store.storeContent(channelId, messageId, 0, CT_PROCESSING_ERROR, `Script error in ${stage}: ${errMsg}`, 'TEXT');
    if (this.config.onError) {
      await this.config.onError({
        channelId, errorType: 'SOURCE_CONNECTOR',
        errorMessage: `Script error in ${stage}: ${errMsg}`, timestamp: Date.now(),
      });
    }
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
    // Parse content based on data type. If parsing fails (e.g., content was
    // transformed to a different format), fall back to raw string.
    let parsedMsg: unknown;
    try {
      parsedMsg = parseForSandbox(content, this.config.dataType);
    } catch {
      parsedMsg = content;
    }
    const base = createSandboxContext(parsedMsg, input.rawContent, parsedMsg);
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
