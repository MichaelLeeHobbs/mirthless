import { tryCatch, type Result } from '@galvanigraph/core-util';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import type { SandboxExecutor, CompiledScript, ExecutionOptions, ExecutionResult } from '../sandbox/sandbox-executor.js';
import type { SandboxContext } from '../sandbox/sandbox-context.js';
import { createSandboxContext } from '../sandbox/sandbox-context.js';
import type { GlobalChannelMap } from '../runtime/global-channel-map.js';
import type { GlobalMapProxy } from '../runtime/global-map-proxy.js';
import { DestinationSet, createDestinationSetProxy } from './destination-set.js';
import { parseForSandbox, serializeFromSandbox, serializeTransformed, type DataTypeOptions } from './data-type-handler.js';
import { mergeVariables, renderDestinationTemplate } from './destination-template.js';
import { reportUnsaved } from './report-unsaved.js';
import { sendFailureReason } from './send-failure.js';

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

export interface DestinationScripts {
  readonly filter?: CompiledScript;
  readonly transformer?: CompiledScript;
  readonly responseTransformer?: CompiledScript;
}

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
  /** Run after the preceding destination finishes instead of in parallel with it (default false). */
  readonly waitForPrevious?: boolean | undefined;
  /** Sent instead of the transformed message, with `${...}` references filled. */
  readonly template?: string | undefined;
}

export function groupDestinationChains(
  destinations: readonly DestinationConfig[],
): ReadonlyArray<readonly DestinationConfig[]> {
  const chains: DestinationConfig[][] = [];
  for (const dest of destinations) {
    const current = chains[chains.length - 1];
    if (dest.waitForPrevious && current) {
      current.push(dest);
    } else {
      chains.push([dest]);
    }
  }
  return chains;
}

export type SendToDestination = (
  metaDataId: number,
  messageId: number,
  content: string,
  signal: AbortSignal,
  correlationId?: string,
  variables?: Readonly<Record<string, unknown>>,
) => Promise<Result<DestinationResponse>>;

/** The message variables that sending this content to the destination looks up. */
export type VariablesUsed = (metaDataId: number, messageId: number, content: string) => readonly string[];

export interface DestinationResponse {
  readonly status: 'SENT' | 'ERROR';
  readonly content: string;
  readonly errorMessage?: string;
}

export interface ContentRow {
  readonly metaDataId: number;
  readonly contentType: number;
  readonly content: string;
  readonly dataType: string;
}

export interface MessageStore {
  createMessage(channelId: string, serverId: string, correlationId?: string): Promise<Result<{ messageId: number; correlationId: string }>>;
  createConnectorMessage(channelId: string, messageId: number, metaDataId: number, name: string, status: string): Promise<Result<void>>;
  updateConnectorMessageStatus(channelId: string, messageId: number, metaDataId: number, status: string, errorCode?: number): Promise<Result<void>>;
  storeContent(channelId: string, messageId: number, metaDataId: number, contentType: number, content: string, dataType: string): Promise<Result<void>>;
  markProcessed(channelId: string, messageId: number): Promise<Result<void>>;
  enqueue(channelId: string, messageId: number, metaDataId: number): Promise<Result<void>>;
  loadContent(channelId: string, messageId: number, metaDataId: number, contentType: number): Promise<Result<string | null>>;
  /** `rotate`: least-attempted messages first, so a message that keeps failing goes to the back. */
  dequeue(channelId: string, metaDataId: number, batchSize: number, rotate?: boolean): Promise<Result<readonly unknown[]>>;
  release(channelId: string, messageId: number, metaDataId: number, newStatus: string): Promise<Result<void>>;
  incrementStats(channelId: string, metaDataId: number, serverId: string, field: 'received' | 'filtered' | 'sent' | 'errored'): Promise<Result<void>>;
  storeAttachment?(channelId: string, messageId: number, attachmentId: string, mimeType: string, content: string, size: number): Promise<Result<void>>;
  /** Drops an earlier failure reason once delivered. */
  removeContent?(channelId: string, messageId: number, metaDataId: number, contentType: number): Promise<Result<void>>;
  storeCustomMetadata?(channelId: string, messageId: number, metaDataId: number, metadata: Readonly<Record<string, unknown>>): Promise<Result<void>>;

  /** Message, source connector, content rows and stats in one round-trip; without it the pipeline makes individual calls. */
  initializeMessage?(
    channelId: string, serverId: string, connectorName: string,
    contentRows: readonly ContentRow[], correlationId?: string,
  ): Promise<Result<{ messageId: number; correlationId: string }>>;

  /** Source status SENT, the sent stat and the processed mark in one round-trip. */
  finalizeMessage?(
    channelId: string, messageId: number, serverId: string,
  ): Promise<Result<void>>;

  /**
   * Applies the channel's removeContentOnCompletion / removeAttachmentsOnCompletion
   * policy. Called only when no destination errored or is still queued, so it never
   * races the queue consumer or destroys content needed to investigate a failure.
   */
  removeCompletedContent?(channelId: string, messageId: number): Promise<Result<void>>;

  /**
   * Called by a queue consumer after it delivers a queued message. Applies the
   * same removal policy only if every destination has now finished without an
   * error: the consumer sees one destination and cannot tell; the store can.
   */
  removeContentIfDelivered?(channelId: string, messageId: number): Promise<Result<void>>;

  /**
   * Optional: true when every connector of the message (the source and each
   * destination) is SENT or FILTERED. Settles whether a message with a queued
   * destination has finished, whichever of the pipeline and the queue consumer
   * gets there last.
   */
  isFullyDelivered?(channelId: string, messageId: number): Promise<Result<boolean>>;
}

export interface PipelineInput {
  readonly rawContent: string;
  readonly sourceMap: Readonly<Record<string, unknown>>;
  /** Reuses an existing cross-channel correlation chain. */
  readonly correlationId?: string | undefined;
  /** A message in the store to run again, left as it was when it was received, instead of creating one. */
  readonly received?: ReceivedMessage | undefined;
  /** Called once a new message is in the store, before any script or destination runs. */
  readonly onStored?: (() => void) | undefined;
}

export interface ReceivedMessage {
  readonly messageId: number;
  readonly correlationId: string;
}

export interface ProcessedMessage {
  readonly messageId: number;
  readonly correlationId: string;
  readonly status: 'SENT' | 'FILTERED' | 'ERROR';
  /**
   * Where an ERROR happened. SOURCE: before routing (invalid content, or a
   * preprocessor, source filter or source transformer failed), so nothing was
   * sent. DESTINATION: the source accepted the message and a destination or
   * postprocessor failed afterwards. Absent unless status is ERROR.
   */
  readonly errorStage?: 'SOURCE' | 'DESTINATION';
  readonly response?: string;
  readonly destinationResults: readonly DestinationResult[];
  /**
   * True when a queued destination had not delivered the message by the time
   * the pipeline finished. The queue consumer reports the delivery later
   * (`QueueConsumerConfig.onMessageDelivered`). Absent otherwise.
   */
  readonly queued?: true;
}

export interface DestinationResult {
  readonly metaDataId: number;
  readonly status: 'SENT' | 'FILTERED' | 'QUEUED' | 'ERROR';
  readonly response?: string;
}

export type AlertEventHandler = (event: {
  readonly channelId: string;
  readonly errorType: string;
  readonly errorMessage: string;
  readonly timestamp: number;
}) => Promise<void>;

export interface StageTiming {
  readonly stage: string;
  readonly durationMs: number;
}

/** Called once per message. */
export type TimingCallback = (messageId: number, totalMs: number, stages: readonly StageTiming[]) => void;

export interface PipelineConfig {
  readonly channelId: string;
  readonly serverId: string;
  readonly dataType: string;
  readonly dataTypeOptions?: DataTypeOptions | undefined;
  readonly scripts: ChannelScripts;
  readonly destinations: readonly DestinationConfig[];
  readonly scriptTimeoutMs?: number | undefined;
  readonly globalChannelMap?: GlobalChannelMap | undefined;
  readonly globalMapProxy?: GlobalMapProxy | undefined;
  readonly configMap?: Readonly<Record<string, unknown>> | undefined;
  readonly onError?: AlertEventHandler | undefined;
  readonly onTiming?: TimingCallback | undefined;
  /** Called when a message store write fails after the point where the message can still be failed cleanly. */
  readonly onStoreFailure?: ((failure: StoreFailure) => void) | undefined;
  /** Absent: the first destination that returned a response. */
  readonly responseSource?: ResponseSource | undefined;
  /** Absent: no destination uses any. */
  readonly variablesUsed?: VariablesUsed | undefined;
  /** Filled after the source transformer. */
  readonly metadataColumns?: readonly MetadataColumnConfig[] | undefined;
}

/** `mapping` names a map variable, looked up in the connector, channel and source maps in that order, as Mirth does. */
export interface MetadataColumnConfig {
  readonly name: string;
  readonly dataType: string;
  readonly mapping: string;
}

export type ResponseSource =
  | { readonly kind: 'POSTPROCESSOR' }
  | { readonly kind: 'DESTINATION'; readonly destinationName: string };

export interface StoreFailure {
  readonly channelId: string;
  readonly messageId: number;
  /** 0 for the source, otherwise the destination. */
  readonly metaDataId: number;
  /** In words a log reader can act on. */
  readonly what: string;
  readonly errorMessage: string;
}

interface PipelineMapState {
  channelMap: Record<string, unknown>;
  responseMap: Record<string, unknown>;
  /** Scoped to one connector: the source, or a single destination. */
  connectorMap: Record<string, unknown>;
}

/**
 * A boolean return (the filter-style `return true`) is a common mistake that must
 * not overwrite the message with the string "true". Boolean and empty returns
 * fall back to the (possibly mutated) `msg` variable.
 */
function scriptReplacement(returnValue: unknown, msg: unknown): unknown {
  if (returnValue != null && typeof returnValue !== 'boolean') return returnValue;
  return msg;
}

function responseText(returnValue: unknown): string | undefined {
  if (returnValue === undefined || returnValue === null) return undefined;
  if (typeof returnValue === 'string') return returnValue;
  if (typeof returnValue === 'object') return JSON.stringify(returnValue);
  return String(returnValue);
}

/** A column with no value, or a NUMBER that is not a number, is left out. */
export function metadataValues(
  columns: readonly MetadataColumnConfig[],
  maps: readonly Readonly<Record<string, unknown>>[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of columns) {
    const raw = maps.map((m) => m[column.mapping]).find((v) => v !== undefined && v !== null);
    if (raw === undefined) continue;
    const value = column.dataType === 'NUMBER' ? numberValue(raw)
      : column.dataType === 'BOOLEAN' ? (raw === true || String(raw).toLowerCase() === 'true')
        : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
    if (value === undefined) continue;
    values[column.name] = value;
  }
  return values;
}

function numberValue(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

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
    this.execOptions = {
      ...execOptions,
      channelId: config.channelId,
      ...(config.scriptTimeoutMs ? { timeout: config.scriptTimeoutMs } : {}),
    };
  }

  async processMessage(
    input: PipelineInput,
    signal: AbortSignal,
  ): Promise<Result<ProcessedMessage>> {
    return tryCatch(async () => {
      const { channelId, serverId, dataType } = this.config;
      const timing = this.config.onTiming;

      const stages: StageTiming[] = [];
      let lastMark = timing ? performance.now() : 0;
      const mark = (stage: string): void => {
        if (!timing) return;
        const now = performance.now();
        stages.push({ stage, durationMs: Math.round((now - lastMark) * 100) / 100 });
        lastMark = now;
      };

      const mapState: PipelineMapState = {
        channelMap: {},
        responseMap: {},
        connectorMap: {},
      };

      const { messageId, correlationId } = input.received ?? await this.createMessage(input);
      mark('initialize');

      // From here the message exists in the store. Whatever goes wrong below must
      // leave it finished with an ERROR status, never sitting in RECEIVED where a
      // polling source would read the same input again and recovery would retry it
      // on every deploy.
      try {
      input.onStored?.();
      let content = input.rawContent;

      try {
        parseForSandbox(content, dataType, this.config.dataTypeOptions);
      } catch (parseErr) {
        const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        // Use inline error-out since errorOut helper isn't defined yet
        await Promise.all([
          this.store.storeContent(channelId, messageId, 0, CONTENT_TYPE.PROCESSING_ERROR, `Invalid ${dataType}: ${parseMsg}`, 'TEXT'),
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
        return { messageId, correlationId, status: 'ERROR' as const, errorStage: 'SOURCE' as const, destinationResults: [] };
      }

      const errorOut = async (stage: string, errMsg: string): Promise<ProcessedMessage> => {
        await this.saved(messageId, 0, 'the ERROR status of a failed message', [
          this.store.storeContent(channelId, messageId, 0, CONTENT_TYPE.PROCESSING_ERROR, errMsg, 'TEXT'),
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
        return { messageId, correlationId, status: 'ERROR' as const, errorStage: 'SOURCE' as const, destinationResults: [] };
      };

      if (this.config.scripts.globalPreprocessor) {
        const gpreResult = await this.runScript(
          this.config.scripts.globalPreprocessor, content, input, signal, mapState,
        );
        if (!gpreResult.ok) return errorOut('globalPreprocessor', gpreResult.error.message);
        const gpreVal = scriptReplacement(gpreResult.value.returnValue, gpreResult.value.msg);
        // A preprocessor that changed nothing leaves the text exactly as received.
        if (gpreVal != null) {
          content = serializeTransformed(gpreVal, content, dataType, this.config.dataTypeOptions);
        }
        mark('globalPreprocessor');
      }

      if (this.config.scripts.preprocessor) {
        const preResult = await this.runScript(
          this.config.scripts.preprocessor, content, input, signal, mapState,
        );
        if (!preResult.ok) return errorOut('preprocessor', preResult.error.message);
        const preVal = scriptReplacement(preResult.value.returnValue, preResult.value.msg);
        if (preVal != null) {
          content = serializeTransformed(preVal, content, dataType, this.config.dataTypeOptions);
        }
        mark('preprocessor');
      }

      const enabledDests = this.config.destinations.filter((d) => d.enabled);
      const destSet = new DestinationSet(
        enabledDests.map((d) => ({ name: d.name, metaDataId: d.metaDataId })),
      );
      const destSetExtras = { destinationSet: createDestinationSetProxy(destSet) };

      if (this.config.scripts.sourceFilter) {
        const filterResult = await this.runScript(
          this.config.scripts.sourceFilter, content, input, signal, mapState, destSetExtras,
        );
        if (!filterResult.ok) return errorOut('sourceFilter', filterResult.error.message);
        mark('sourceFilter');
        if (filterResult.value.returnValue !== true) {
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

      if (this.config.scripts.sourceTransformer) {
        const txResult = await this.runScript(
          this.config.scripts.sourceTransformer, content, input, signal, mapState, destSetExtras,
        );
        if (!txResult.ok) return errorOut('sourceTransformer', txResult.error.message);
        const transformed = scriptReplacement(txResult.value.returnValue, txResult.value.msg);
        content = serializeTransformed(transformed, content, dataType, this.config.dataTypeOptions);
        mark('sourceTransformer');
      }

      // Every destination row must exist before the source is marked TRANSFORMED:
      // recovery reads TRANSFORMED as "routing began", so a destination later in a
      // waitForPrevious chain would otherwise be missing after a crash and never
      // be delivered. Nothing has been sent yet, so a failure here fails cleanly.
      const activeIds = destSet.getActiveMetaDataIds();
      const activeDests = this.config.destinations
        .filter((d) => d.enabled && (!activeIds || activeIds.has(d.metaDataId)));
      const prepared = await Promise.all([
        this.config.scripts.sourceTransformer
          ? this.store.storeContent(channelId, messageId, 0, CONTENT_TYPE.TRANSFORMED, content, dataType)
          : Promise.resolve({ ok: true as const, value: undefined, error: null }),
        ...activeDests.map((d) => this.store.createConnectorMessage(channelId, messageId, d.metaDataId, d.name, 'RECEIVED')),
        this.storeSourceMetadata(messageId, mapState, input.sourceMap),
      ]);
      const notPrepared = prepared.find((r) => !r.ok);
      if (notPrepared && !notPrepared.ok) return errorOut('prepareDestinations', notPrepared.error.message);
      const routed = await this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'TRANSFORMED');
      if (!routed.ok) return errorOut('storeTransformed', routed.error.message);
      mark('storeTransformed');

      const destResults = await this.routeToDestinations(
        messageId, content, input, signal, mapState, activeDests, correlationId,
      );
      mark('destinations');

      const destHasError = destResults.some((r) => r.status === 'ERROR');
      // Both postprocessors can fail for one message. Their errors are stored
      // together: the store keeps one error text per connector message.
      const postErrors: string[] = [];

      let postprocessorResponse: string | undefined;
      if (this.config.scripts.postprocessor) {
        const postResult = await this.runScript(
          this.config.scripts.postprocessor, content, input, signal, mapState,
        );
        if (!postResult.ok) {
          postErrors.push(`Script error in postprocessor: ${postResult.error.message}`);
        } else {
          postprocessorResponse = responseText(postResult.value.returnValue);
        }
        mark('postprocessor');
      }

      if (this.config.scripts.globalPostprocessor) {
        const gpostResult = await this.runScript(
          this.config.scripts.globalPostprocessor, content, input, signal, mapState,
        );
        if (!gpostResult.ok) {
          postErrors.push(`Script error in globalPostprocessor: ${gpostResult.error.message}`);
        }
        mark('globalPostprocessor');
      }

      const postprocessorFailed = postErrors.length > 0;
      if (postprocessorFailed) await this.storeAndAlertPostError(messageId, postErrors.join('\n'));
      const hasError = destHasError || postprocessorFailed;

      // Never record the source as SENT when a destination or postprocessor
      // failed: that would overcount throughput and hide failures.
      const hasQueued = destResults.some((r) => r.status === 'QUEUED');
      const finalWhat = 'the final message status';
      if (hasError) {
        await this.saved(messageId, 0, finalWhat, [
          this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'ERROR'),
          this.store.incrementStats(channelId, 0, serverId, 'errored'),
          this.store.markProcessed(channelId, messageId),
        ]);
      } else if (this.store.finalizeMessage) {
        await this.saved(messageId, 0, finalWhat, [this.store.finalizeMessage(channelId, messageId, serverId)]);
      } else {
        await this.saved(messageId, 0, finalWhat, [
          this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'SENT'),
          this.store.incrementStats(channelId, 0, serverId, 'sent'),
          this.store.markProcessed(channelId, messageId),
        ]);
      }

      // A queued destination may have delivered while the rest of the pipeline
      // ran. Its consumer then saw the message unfinished and left the
      // completion work to us.
      const stillQueued = hasQueued && !(await this.deliveredMeanwhile(messageId));

      // Apply removeContentOnCompletion only when the message is fully done — no
      // errors and nothing still queued (a queued destination needs the stored
      // content to deliver later, and error content must be kept for investigation).
      if (!hasError && !stillQueued && this.store.removeCompletedContent) {
        await this.store.removeCompletedContent(channelId, messageId);
      }
      mark('finalize');

      if (timing) {
        timing(messageId, stages.reduce((s, t) => s + t.durationMs, 0), stages);
      }

      if (destHasError && this.config.onError) {
        await this.config.onError({
          channelId,
          errorType: 'DESTINATION_CONNECTOR',
          errorMessage: `Destination error in message ${String(messageId)}`,
          timestamp: Date.now(),
        });
      }

      const firstResponse = this.pickResponse(destResults, postprocessorResponse);
      const result: ProcessedMessage = {
        messageId,
        correlationId,
        status: hasError ? 'ERROR' as const : 'SENT' as const,
        ...(hasError ? { errorStage: 'DESTINATION' as const } : {}),
        destinationResults: destResults,
        ...(stillQueued ? { queued: true as const } : {}),
      };
      if (firstResponse) {
        return { ...result, response: firstResponse };
      }
      return result;
      } catch (unexpected) {
        const reason = unexpected instanceof Error ? unexpected.message : String(unexpected);
        await this.failUnexpected(messageId, reason);
        return { messageId, correlationId, status: 'ERROR' as const, errorStage: 'SOURCE' as const, destinationResults: [] };
      }
    });
  }

  private async createMessage(input: PipelineInput): Promise<ReceivedMessage> {
    const { channelId, serverId, dataType } = this.config;
    if (this.store.initializeMessage) {
      const initResult = await this.store.initializeMessage(channelId, serverId, 'Source', [
        { metaDataId: 0, contentType: CONTENT_TYPE.RAW, content: input.rawContent, dataType },
        { metaDataId: 0, contentType: CONTENT_TYPE.SOURCE_MAP, content: JSON.stringify(input.sourceMap), dataType: 'JSON' },
      ], input.correlationId);
      if (!initResult.ok) throw new Error('Failed to initialize message');
      return initResult.value;
    }
    const createResult = await this.store.createMessage(channelId, serverId, input.correlationId);
    if (!createResult.ok) throw new Error('Failed to create message');
    const { messageId } = createResult.value;
    const initial = await Promise.all([
      this.store.createConnectorMessage(channelId, messageId, 0, 'Source', 'RECEIVED'),
      this.store.storeContent(channelId, messageId, 0, CONTENT_TYPE.RAW, input.rawContent, dataType),
      this.store.storeContent(channelId, messageId, 0, CONTENT_TYPE.SOURCE_MAP, JSON.stringify(input.sourceMap), 'JSON'),
      this.store.incrementStats(channelId, 0, serverId, 'received'),
    ]);
    // A message whose raw content was not stored cannot be recovered or
    // reprocessed, so refuse it: the sender gets an error and resends.
    if (initial.some((r) => !r.ok)) throw new Error('Failed to initialize message');
    return createResult.value;
  }

  /**
   * Whether the queued destinations of a just-finished message have all
   * delivered already. A store that cannot tell, or a failed check, counts as
   * not delivered: the message's completion then waits for the queue consumer.
   */
  private async deliveredMeanwhile(messageId: number): Promise<boolean> {
    if (!this.store.isFullyDelivered) return false;
    const delivered = await this.store.isFullyDelivered(this.config.channelId, messageId);
    if (delivered.ok) return delivered.value;
    // If the queue already delivered and saw the message unfinished, nobody
    // finishes it: its source keeps its input and its content stays. Say so.
    if (this.config.onError) {
      await this.config.onError({
        channelId: this.config.channelId,
        errorType: 'DESTINATION_CONNECTOR',
        errorMessage: `Message ${String(messageId)} has a queued destination, and whether it has delivered could not be read: ` +
          `${delivered.error.message}. If it has, the source's after-processing action and content removal will not run.`,
        timestamp: Date.now(),
      });
    }
    return false;
  }

  /** Finish a message that failed with an error no stage handled. */
  private async failUnexpected(messageId: number, reason: string): Promise<void> {
    const { channelId, serverId } = this.config;
    const errorMessage = `Unexpected error while processing: ${reason}`;
    await this.saved(messageId, 0, 'the ERROR status of a failed message', [
      this.store.storeContent(channelId, messageId, 0, CONTENT_TYPE.PROCESSING_ERROR, errorMessage, 'TEXT'),
      this.store.updateConnectorMessageStatus(channelId, messageId, 0, 'ERROR'),
      this.store.incrementStats(channelId, 0, serverId, 'errored'),
      this.store.markProcessed(channelId, messageId),
    ]);
    if (this.config.onError) {
      await this.config.onError({ channelId, errorType: 'SOURCE_CONNECTOR', errorMessage, timestamp: Date.now() });
    }
  }

  /** The destinations' connector rows must already exist. */
  private async routeToDestinations(
    messageId: number,
    content: string,
    input: PipelineInput,
    signal: AbortSignal,
    mapState: PipelineMapState,
    active: ReadonlyArray<DestinationConfig>,
    correlationId?: string | undefined,
  ): Promise<readonly DestinationResult[]> {
    const { channelId, serverId, dataType } = this.config;

    const processDestination = async (dest: DestinationConfig): Promise<DestinationResult> => {
      const destMaps: PipelineMapState = {
        channelMap: mapState.channelMap,
        responseMap: mapState.responseMap,
        connectorMap: {},
      };
      let destContent = content;

      // A filter script error must fail the destination loudly, never fall through
      // as if the filter passed (which would send unfiltered PHI downstream).
      if (dest.scripts.filter) {
        const filterResult = await this.runScript(
          dest.scripts.filter, destContent, input, signal, destMaps,
        );
        if (!filterResult.ok) {
          return this.destErrorOut(messageId, dest, 'destinationFilter', filterResult.error.message);
        }
        if (filterResult.value.returnValue !== true) {
          await Promise.all([
            this.store.updateConnectorMessageStatus(channelId, messageId, dest.metaDataId, 'FILTERED'),
            this.store.incrementStats(channelId, dest.metaDataId, serverId, 'filtered'),
          ]);
          return { metaDataId: dest.metaDataId, status: 'FILTERED' as const };
        }
      }

      // Never send untransformed content downstream on a transformer failure.
      if (dest.scripts.transformer) {
        const txResult = await this.runScript(
          dest.scripts.transformer, destContent, input, signal, destMaps,
        );
        if (!txResult.ok) {
          return this.destErrorOut(messageId, dest, 'destinationTransformer', txResult.error.message);
        }
        const transformed = scriptReplacement(txResult.value.returnValue, txResult.value.msg);
        destContent = serializeTransformed(transformed, destContent, dataType, this.config.dataTypeOptions);
      }

      // What scripts put in this message's maps travels with the send (and is
      // stored for a queued one). The source map is already stored with the
      // message, and the shared maps are read in memory only: the configuration
      // map can hold credentials that must not be copied into every message.
      const variables = mergeVariables([destMaps.connectorMap, destMaps.channelMap, destMaps.responseMap]);
      if (dest.template !== undefined) {
        destContent = renderDestinationTemplate(dest.template, { encoded: destContent, raw: input.rawContent, messageId }, [
          variables, input.sourceMap, this.config.globalChannelMap?.toRecord() ?? {}, this.config.globalMapProxy?.toRecord() ?? {}, this.config.configMap ?? {},
        ]);
      }
      const variablesStored = await this.storeVariables(messageId, dest, variables, destContent);
      if (!variablesStored.ok) {
        return this.destErrorOut(messageId, dest, 'storeVariables', variablesStored.error.message);
      }

      // Stored before queuing or sending: a queued destination reloads exactly this
      // row, and crash recovery redispatches from it. If the write fails, error now
      // rather than silently lose the message or deliver un-persisted PHI.
      const storeSentResult = await this.store.storeContent(
        channelId, messageId, dest.metaDataId, CONTENT_TYPE.SENT, destContent, dataType,
      );
      if (!storeSentResult.ok) {
        return this.destErrorOut(messageId, dest, 'storeSentContent', storeSentResult.error.message);
      }

      if (dest.queueMode === 'ALWAYS') {
        return this.enqueueDestination(messageId, dest);
      }

      const sendResult = await this.sendFn(
        dest.metaDataId, messageId, destContent, signal, correlationId,
        Object.keys(variables).length > 0 ? variables : undefined,
      );

      if (!sendResult.ok) {
        await this.recordSendFailure(messageId, dest.metaDataId, sendResult);
        if (dest.queueMode === 'ON_FAILURE') {
          return this.enqueueDestination(messageId, dest);
        }
        await this.saved(messageId, dest.metaDataId, 'the ERROR status of a failed destination', [
          this.store.updateConnectorMessageStatus(channelId, messageId, dest.metaDataId, 'ERROR'),
          this.store.incrementStats(channelId, dest.metaDataId, serverId, 'errored'),
        ]);
        return { metaDataId: dest.metaDataId, status: 'ERROR' as const };
      }

      const response = sendResult.value;

      if (response.status === 'SENT') {
        // What the destination answered is in its own format (an ACK, an HTTP
        // body, a file path), not the channel's inbound data type.
        await this.store.storeContent(
          channelId, messageId, dest.metaDataId, CONTENT_TYPE.RESPONSE, response.content, 'TEXT',
        );

        mapState.responseMap[dest.name] = { status: response.status, content: response.content };

        // A response transformer error is surfaced (error content + alert), but the
        // message was already delivered, so the destination stays SENT with the
        // untransformed response: ERROR could trigger a duplicate redelivery.
        let responseContent = response.content;
        if (dest.scripts.responseTransformer) {
          const rtResult = await this.runScript(
            dest.scripts.responseTransformer, response.content, input, signal, destMaps,
          );
          if (rtResult.ok) {
            const transformed = scriptReplacement(rtResult.value.returnValue, rtResult.value.msg);
            responseContent = serializeFromSandbox(transformed, dataType, response.content, this.config.dataTypeOptions);
            await this.store.storeContent(
              channelId, messageId, dest.metaDataId, CONTENT_TYPE.RESPONSE_TRANSFORMED, responseContent, dataType,
            );
          } else {
            await this.store.storeContent(
              channelId, messageId, dest.metaDataId, CONTENT_TYPE.PROCESSING_ERROR,
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

        // The message is delivered and cannot be taken back. If this write
        // fails, a restart would find the destination still RECEIVED and send
        // it again, so say so loudly rather than carry on in silence.
        await this.saved(messageId, dest.metaDataId, 'the SENT status of a delivered destination', [
          this.store.updateConnectorMessageStatus(channelId, messageId, dest.metaDataId, 'SENT'),
          this.store.incrementStats(channelId, dest.metaDataId, serverId, 'sent'),
        ]);
        return {
          metaDataId: dest.metaDataId,
          status: 'SENT' as const,
          response: responseContent,
        };
      }

      await this.recordSendFailure(messageId, dest.metaDataId, sendResult);
      if (dest.queueMode === 'ON_FAILURE') {
        return this.enqueueDestination(messageId, dest);
      }
      await this.saved(messageId, dest.metaDataId, 'the ERROR status of a failed destination', [
        this.store.updateConnectorMessageStatus(channelId, messageId, dest.metaDataId, 'ERROR'),
        this.store.incrementStats(channelId, dest.metaDataId, serverId, 'errored'),
      ]);
      return { metaDataId: dest.metaDataId, status: 'ERROR' as const };
    };

    // Chains run in parallel; destinations within a chain run in order, so a
    // waitForPrevious destination sees the earlier destination's responseMap entry.
    const settled = await Promise.all(groupDestinationChains(active).map(async (chain) => {
      const chainResults: DestinationResult[] = [];
      for (const dest of chain) {
        chainResults.push(await processDestination(dest));
      }
      return chainResults;
    }));
    return settled.flat();
  }

  /** Kept so the message browser can say what went wrong whether the destination ends ERROR or waits in the queue. */
  private async recordSendFailure(messageId: number, metaDataId: number, result: Result<DestinationResponse>): Promise<void> {
    const { channelId } = this.config;
    const response = result.ok ? result.value.content : '';
    await this.saved(messageId, metaDataId, 'why a destination failed', [
      this.store.storeContent(channelId, messageId, metaDataId, CONTENT_TYPE.ERROR, sendFailureReason(result), 'TEXT'),
      ...(response ? [this.store.storeContent(channelId, messageId, metaDataId, CONTENT_TYPE.RESPONSE, response, 'TEXT')] : []),
    ]);
  }

  private async enqueueDestination(
    messageId: number,
    dest: DestinationConfig,
  ): Promise<DestinationResult> {
    const enqueueResult = await this.store.enqueue(this.config.channelId, messageId, dest.metaDataId);
    if (!enqueueResult.ok) {
      // Otherwise it would be marked QUEUED but sit undelivered forever (the queue
      // consumer never sees it, recovery skips processed rows). Fail loud, not lost.
      return this.destErrorOut(messageId, dest, 'enqueue', enqueueResult.error.message);
    }
    return { metaDataId: dest.metaDataId, status: 'QUEUED' as const };
  }

  private async destErrorOut(
    messageId: number,
    dest: DestinationConfig,
    stage: string,
    errMsg: string,
  ): Promise<DestinationResult> {
    const { channelId, serverId } = this.config;
    await this.saved(messageId, dest.metaDataId, 'the ERROR status of a failed destination', [
      this.store.storeContent(channelId, messageId, dest.metaDataId, CONTENT_TYPE.PROCESSING_ERROR, `Script error in ${stage}: ${errMsg}`, 'TEXT'),
      this.store.updateConnectorMessageStatus(channelId, messageId, dest.metaDataId, 'ERROR'),
      this.store.incrementStats(channelId, dest.metaDataId, serverId, 'errored'),
    ]);
    return { metaDataId: dest.metaDataId, status: 'ERROR' as const };
  }

  private async storeAndAlertPostError(messageId: number, errorMessage: string): Promise<void> {
    const { channelId } = this.config;
    await this.saved(messageId, 0, 'a postprocessor error', [
      this.store.storeContent(channelId, messageId, 0, CONTENT_TYPE.PROCESSING_ERROR, errorMessage, 'TEXT'),
    ]);
    if (this.config.onError) {
      await this.config.onError({ channelId, errorType: 'SOURCE_CONNECTOR', errorMessage, timestamp: Date.now() });
    }
  }

  private saved(
    messageId: number,
    metaDataId: number,
    what: string,
    writes: ReadonlyArray<Promise<Result<unknown>>>,
  ): Promise<void> {
    return reportUnsaved(writes, { channelId: this.config.channelId, messageId, metaDataId, what }, this.config.onStoreFailure);
  }

  /**
   * Keep the variables a queued destination will send with: the queue sends
   * later, from the store, when the message's maps are gone. A destination that
   * never queues gets them from memory. An empty set is kept only for one that
   * uses variables, whose later send must tell none from none kept.
   */
  private storeVariables(messageId: number, dest: DestinationConfig, variables: Readonly<Record<string, unknown>>, content: string): Promise<Result<void>> {
    const kept = dest.queueMode !== 'NEVER'
      && (Object.keys(variables).length > 0 || (this.config.variablesUsed?.(dest.metaDataId, messageId, content) ?? []).length > 0);
    if (!kept) return Promise.resolve({ ok: true, value: undefined, error: null } as Result<void>);
    return this.store.storeContent(this.config.channelId, messageId, dest.metaDataId, CONTENT_TYPE.CHANNEL_MAP, JSON.stringify(variables), 'JSON');
  }

  private storeSourceMetadata(
    messageId: number,
    mapState: PipelineMapState,
    sourceMap: Readonly<Record<string, unknown>>,
  ): Promise<Result<void>> {
    const values = metadataValues(this.config.metadataColumns ?? [], [mapState.connectorMap, mapState.channelMap, sourceMap]);
    if (Object.keys(values).length === 0 || !this.store.storeCustomMetadata) {
      return Promise.resolve({ ok: true, value: undefined, error: null } as Result<void>);
    }
    return this.store.storeCustomMetadata(this.config.channelId, messageId, 0, values);
  }

  private pickResponse(destResults: readonly DestinationResult[], postprocessorResponse: string | undefined): string | undefined {
    const source = this.config.responseSource;
    if (source?.kind === 'POSTPROCESSOR') return postprocessorResponse;
    if (source?.kind === 'DESTINATION') {
      const dest = this.config.destinations.find((d) => d.name === source.destinationName);
      return dest ? destResults.find((r) => r.metaDataId === dest.metaDataId)?.response : undefined;
    }
    return destResults.find((r) => r.response)?.response;
  }

  private async runScript(
    script: CompiledScript,
    content: string,
    input: PipelineInput,
    signal: AbortSignal,
    mapState: PipelineMapState,
    extras?: Readonly<Record<string, unknown>> | undefined,
  ): Promise<Result<ExecutionResult>> {
    // Content a transformer turned into another format no longer parses: pass the raw string.
    let parsedMsg: unknown;
    try {
      parsedMsg = parseForSandbox(content, this.config.dataType, this.config.dataTypeOptions);
    } catch {
      parsedMsg = content;
    }
    const base = createSandboxContext(parsedMsg, input.rawContent, parsedMsg);
    const gcm = this.config.globalChannelMap;
    const globalMapProxy = this.config.globalMapProxy;
    // Snapshots of the shared maps as the script sees them. Only the keys the
    // script changes are written back, so a slow script cannot overwrite what
    // another message stored while it was running.
    const gcmBefore = gcm?.toRecord();
    const globalBefore = globalMapProxy?.toRecord();
    const context: SandboxContext = {
      ...base,
      channelMap: { ...mapState.channelMap },
      responseMap: { ...mapState.responseMap },
      connectorMap: { ...mapState.connectorMap },
      sourceMap: input.sourceMap,
      ...(gcmBefore ? { globalChannelMap: gcmBefore } : {}),
      ...(globalBefore ? { globalMap: globalBefore } : {}),
      ...(this.config.configMap ? { configMap: this.config.configMap } : {}),
      ...(extras ? { extras } : {}),
    };
    const result = await this.sandbox.execute(script, context, { ...this.execOptions, signal });
    if (result.ok) {
      const updates = result.value.mapUpdates;
      Object.assign(mapState.channelMap, updates.channelMap);
      Object.assign(mapState.responseMap, updates.responseMap);
      Object.assign(mapState.connectorMap, updates.connectorMap);
      if (gcm && gcmBefore) gcm.applyChanges(gcmBefore, updates.globalChannelMap);
      if (globalMapProxy && globalBefore) globalMapProxy.applyChanges(globalBefore, updates.globalMap);
    }
    return result;
  }
}
