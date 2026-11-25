import {
  ChannelRuntime,
  VmSandboxExecutor,
  MessageProcessor,
  DEFAULT_EXECUTION_OPTIONS,
  GlobalChannelMap,
  GlobalMapProxy,
  QueueConsumer,
  compileScript,
  globalsNamed,
  compileFilterRulesToScript,
  compileTransformerStepsToScript,
  prependTemplates,
  AlertManager,
  DestinationRedispatcher,
  RecoveryManager,
  type AlertEventHandler,
  type ReceivedMessage,
  type RecoveryStore,
  type RedispatchDestinationFn,
  type StoreFailure,
  type VariablesUsed,
  type ChannelRuntimeConfig,
  type PipelineConfig,
  type ChannelScripts,
  type DestinationConfig,
  type DestinationScripts,
  type SandboxExecutor,
  type ExecutionResult,
  type BridgeDependencies,
  type MessageStore,
  type SendToDestination,
  type CompiledScript,
  type CodeTemplateData,
  type QueueConsumerConfig,
  type LoadedAlert,
  type ResponseSource,
  parseForSandbox,
  reportUnsaved,
  type DataTypeOptions,
} from '@galvanigraph/engine';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isPlainObject, settleWithin, splitHl7Batch } from '@galvanigraph/core-util';
import { tryCatch, type Result } from 'stderr-lib';
import {
  createSourceConnector,
  createDestinationConnector,
  JavaScriptReceiver,
  JavaScriptDispatcher,
  DISPATCH_STATUS,
  type DispatchStatus,
  type ConnectorMessage,
  type SourceConnectorRuntime,
  type DestinationConnectorRuntime,
} from '@galvanigraph/connectors';
import { AUDIT_ACTION, EVENT_NAME, MESSAGE_STORAGE_MODE, CONTENT_TYPE, SOCKET_EVENT, type MessageStorageMode, storeRecordSchema, findRecordsSchema, updateRecordSchema, collectionRecordIdSchema, delimitedOptionsSchema, destinationTemplate } from '@galvanigraph/core-models';
import { MessageService } from './services/message.service.js';
import { GlobalMapService } from './services/global-map.service.js';
import { ConfigMapService } from './services/config-map.service.js';
import { config } from './config/index.js';
import { CollectionService, type CollectionRecordResult } from './services/collection.service.js';
import { ResourceService } from './services/resource.service.js';
import { DataSourceService } from './services/data-source.service.js';
import { AlertService } from './services/alert.service.js';
import { EmailService } from './services/email.service.js';
import { resolveHttpSourceTls, resolveHttpDestinationTls, resolveQueueTls } from './services/connector-tls-resolver.js';
import { ServiceError } from './lib/service-error.js';
import { safeHttpFetch } from './lib/safe-http-fetch.js';
import { buildFileRoots } from './lib/file-roots.js';
import { encryptContent, isContentEncryptionConfigured } from './lib/content-crypto.js';
import logger from './lib/logger.js';
import { emitAuditEvent, emitEvent } from './lib/event-emitter.js';
import { emitToChannelAudience } from './lib/socket.js';
import type { ChannelDetail } from './services/channel.service.js';
import type { DeploymentBundle } from './services/deployment-record.service.js';

interface ChannelRecovery {
  readonly channel: ChannelDetail;
  readonly store: MessageStore;
  readonly runAgain: (message: ReceivedMessage, rawContent: string, sourceMap: Record<string, unknown>) => Promise<Result<unknown>>;
  readonly sendFn: SendToDestination;
  readonly destinations: readonly DestinationConfig[];
  readonly variablesUsed: VariablesUsed;
  readonly raiseAlert: AlertEventHandler;
  readonly horizon: Result<number>;
  readonly runSignal: AbortSignal;
  readonly haltSignal: AbortSignal;
}

/** The maps a channel's own scripts (deploy, undeploy, JavaScript connectors) share with its pipeline. */
interface ChannelMaps {
  readonly gcm: GlobalChannelMap;
  readonly globalMap: GlobalMapProxy;
  readonly configMap: Readonly<Record<string, unknown>>;
}


export interface DeployedChannel {
  readonly channelId: string;
  readonly runtime: ChannelRuntime;
  readonly config: ChannelDetail;
  readonly globalChannelMap: GlobalChannelMap;
  readonly globalMapProxy: GlobalMapProxy;
  /** The configuration map as it was at deploy time. */
  readonly configMap: Readonly<Record<string, unknown>>;
  readonly alertManager: AlertManager;
  readonly queueConsumers: readonly QueueConsumer[];
  readonly scripts: ChannelScripts;
  readonly processMessage: (rawContent: string, sourceMap?: Record<string, unknown>) => Promise<Result<SourceDispatchOutcome>>;
  readonly variablesUsed: VariablesUsed;
  /**
   * Recover messages a prior crash left unprocessed. Runs on the first start
   * after deploy (call it after the runtime has started): destination
   * dispatchers only accept sends once started, so recovering at deploy time
   * marked every pending destination ERROR. One that failed, or that a stop or
   * a halt interrupted, goes on at the next start; after one that went through
   * every message, calls are no-ops.
   */
  readonly recoverOnce: () => Promise<void>;
  /** Releases queue claims left by a server stop. Run before the queue consumers start. */
  readonly resetClaimsOnce: () => Promise<void>;
  /** When the channel last received a message (or last (re)started); drives NO_MESSAGES alerts. */
  readonly activity: { lastAt: number };
}

/**
 * What the source connector learns about a dispatched message. `status` lets a
 * source connector build the right response (e.g. an MLLP receiver returns an AA
 * ACK for SENT, AE for ERROR, AA for FILTERED).
 */
export interface SourceDispatchOutcome {
  readonly messageId: number;
  readonly status: DispatchStatus;
  readonly response?: string;
  /** A queued destination has not delivered yet (see `DispatchResult.queued`). */
  readonly queued?: true;
  /** A destination failed although status is PROCESSED (see `DispatchResult.destinationFailed`). */
  readonly destinationFailed?: true;
}

/** What a JavaScript destination's script can read its message's variables by. */
const VARIABLE_GLOBALS: readonly string[] = ['channelMap', '$c', '$', 'connectorMessage', 'globalThis'];

const RESPOND_BEFORE_DESTINATIONS: ReadonlySet<string> = new Set(['AUTO_BEFORE', 'AUTO_AFTER_TRANSFORMER']);

/**
 * The channel's response mode decides whether a destination failure counts:
 * - AUTO_BEFORE / AUTO_AFTER_TRANSFORMER: no. The message was accepted and
 *   recorded, so the sender gets a success and does not resend (a resend would
 *   deliver a second copy to the destinations that worked).
 * - every other mode (AUTO_AFTER_DESTINATIONS is the default): yes.
 * An error before routing is reported (nothing was delivered), except under
 * AUTO_BEFORE, which answers once the message is recorded, before processing.
 */
export function toDispatchStatus(
  outcome: { readonly status: 'SENT' | 'FILTERED' | 'ERROR'; readonly errorStage?: 'SOURCE' | 'DESTINATION' | undefined },
  responseMode: string,
): DispatchStatus {
  if (outcome.status === 'FILTERED') return DISPATCH_STATUS.FILTERED;
  if (outcome.status !== 'ERROR') return DISPATCH_STATUS.PROCESSED;
  // Mirth's "Before processing" answers as soon as the message is recorded;
  // the failure stays on the message and raises its alert.
  if (responseMode === 'AUTO_BEFORE') return DISPATCH_STATUS.PROCESSED;
  if (outcome.errorStage === 'DESTINATION' && RESPOND_BEFORE_DESTINATIONS.has(responseMode)) {
    return DISPATCH_STATUS.PROCESSED;
  }
  return DISPATCH_STATUS.ERROR;
}

/**
 * What the source connector learns about a processed message: the status
 * the response mode gives it, plus what a source that removes its input
 * needs to keep it (a queued destination still waiting, or a failure the
 * status does not show).
 */
export function toSourceOutcome(
  processed: {
    readonly messageId: number;
    readonly status: 'SENT' | 'FILTERED' | 'ERROR';
    readonly errorStage?: 'SOURCE' | 'DESTINATION' | undefined;
    readonly response?: string | undefined;
    readonly queued?: true | undefined;
  },
  responseMode: string,
): SourceDispatchOutcome {
  const status = toDispatchStatus(processed, responseMode);
  const hiddenFailure = processed.status === 'ERROR' && status !== DISPATCH_STATUS.ERROR;
  return {
    messageId: processed.messageId,
    status,
    ...(processed.response === undefined ? {} : { response: processed.response }),
    ...(processed.queued ? { queued: true as const } : {}),
    ...(hiddenFailure ? { destinationFailed: true as const } : {}),
  };
}

/** What a deploy, JavaScript Reader or JavaScript Writer script runs on. */
interface ChannelScriptInput {
  /** The raw text (`rawData`). */
  readonly content: string;
  /** The message as `msg`; the raw text when absent. */
  readonly msg?: unknown;
  readonly channelMap?: Readonly<Record<string, unknown>>;
}

/** The raw text when it does not parse, as the pipeline falls back. */
export function parsedOrRaw(content: string, dataType: string, options?: DataTypeOptions): unknown {
  try {
    return parseForSandbox(content, dataType, options);
  } catch {
    return content;
  }
}

/**
 * Throws a ServiceError on settings that do not validate, so the channel
 * refuses to deploy instead of splitting rows the wrong way.
 */
export function dataTypeOptionsFor(channel: ChannelDetail): DataTypeOptions {
  if (channel.inboundDataType !== 'DELIMITED') return {};
  const source = channel.transformers.find((t) => t.connectorId === null);
  const parsed = delimitedOptionsSchema.safeParse(source?.inboundProperties['delimited'] ?? {});
  if (!parsed.success) {
    throw new ServiceError('INVALID_INPUT', `Channel ${channel.name}: Delimited settings are invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  return { delimited: parsed.data };
}

/**
 * Process each message of a batch, in order, and report the batch as one
 * outcome: an error if the batch could not be split or any message failed
 * (so the source keeps or quarantines it), otherwise the last message's
 * outcome. Every message is processed even after one fails, as Mirth does.
 */
export async function processBatch(
  split: (content: string) => string[],
  content: string,
  processOne: (part: string) => Promise<Result<SourceDispatchOutcome>>,
): Promise<Result<SourceDispatchOutcome>> {
  const parts = tryCatch((): string[] => {
    const list = split(content);
    if (list.length === 0) throw new Error('The batch holds no messages');
    return list;
  });
  if (!parts.ok) return { ok: false, value: null, error: parts.error } as Result<SourceDispatchOutcome>;
  let outcome: Result<SourceDispatchOutcome> | undefined;
  let failure: Result<SourceDispatchOutcome> | undefined;
  for (const part of parts.value) {
    outcome = await processOne(part);
    if (!failure && (!outcome.ok || outcome.value.status === DISPATCH_STATUS.ERROR)) failure = outcome;
  }
  return failure ?? outcome!;
}

export function toResponseSource(responseMode: string, responseConnectorName: string | null): ResponseSource | undefined {
  if (responseMode === 'POSTPROCESSOR') return { kind: 'POSTPROCESSOR' };
  if (responseMode === 'DESTINATION' && responseConnectorName) {
    return { kind: 'DESTINATION', destinationName: responseConnectorName };
  }
  return undefined;
}

export interface StorageConfig {
  readonly messageStorageMode: MessageStorageMode;
  readonly removeContentOnCompletion: boolean;
  readonly removeAttachmentsOnCompletion: boolean;
  readonly encryptData: boolean;
}

const OK_VOID = { ok: true as const, value: undefined, error: null } as Result<void>;
const INTERRUPTED = { ok: false as const, value: null, error: new Error('Interrupted: the channel stopped') } as Result<void>;

function fail<T>(error: Result<T>['error'] & object): Result<T> {
  return { ok: false, value: null, error } as Result<T>;
}

const ERROR_CONTENT_TYPES: ReadonlySet<number> = new Set([
  CONTENT_TYPE.ERROR, CONTENT_TYPE.RESPONSE_ERROR, CONTENT_TYPE.PROCESSING_ERROR,
]);

/**
 * PRODUCTION stores everything needed to deliver, view, recover, and reprocess a
 * message — RAW (reprocess), SENT (queued delivery + crash recovery), the
 * transformed/encoded/response bodies (message browser), and all errors. It omits
 * only the debug-only PROCESSED copy and the source map snapshot (Mirth's
 * "Production" semantics). RAW must be present or crash recovery and reprocess
 * break; SENT and a queued destination's variables (CHANNEL_MAP) must be present
 * or the queue cannot deliver what was routed.
 */
const PRODUCTION_CONTENT_TYPES: ReadonlySet<number> = new Set([
  CONTENT_TYPE.RAW, CONTENT_TYPE.TRANSFORMED, CONTENT_TYPE.ENCODED,
  CONTENT_TYPE.SENT, CONTENT_TYPE.RESPONSE, CONTENT_TYPE.RESPONSE_TRANSFORMED,
  CONTENT_TYPE.RESPONSE_SENT, CONTENT_TYPE.CHANNEL_MAP,
  ...ERROR_CONTENT_TYPES,
]);

/** RAW mode keeps only the raw inbound content (enough to reprocess) plus errors. */
const RAW_CONTENT_TYPES: ReadonlySet<number> = new Set([
  CONTENT_TYPE.RAW, ...ERROR_CONTENT_TYPES,
]);

export function shouldStoreContent(mode: MessageStorageMode, contentType: number): boolean {
  if (mode === MESSAGE_STORAGE_MODE.DEVELOPMENT) return true;
  if (mode === MESSAGE_STORAGE_MODE.PRODUCTION) return PRODUCTION_CONTENT_TYPES.has(contentType);
  if (mode === MESSAGE_STORAGE_MODE.RAW) return RAW_CONTENT_TYPES.has(contentType);
  return false;
}

/**
 * A storage mode stores enough content to deliver a queued message and recover it
 * after a crash (needs RAW + SENT). RAW does not store SENT and METADATA/DISABLED
 * store neither, so a queued destination on such a channel would lose 100% of
 * messages. Used to reject the combination at deploy time.
 */
export function storageModeSupportsQueue(mode: MessageStorageMode): boolean {
  return shouldStoreContent(mode, CONTENT_TYPE.SENT) && shouldStoreContent(mode, CONTENT_TYPE.RAW);
}

export function createMessageStoreAdapter(config?: StorageConfig): MessageStore {
  const mode = config?.messageStorageMode ?? MESSAGE_STORAGE_MODE.DEVELOPMENT;
  const encrypt = config?.encryptData ?? false;
  const removesOnCompletion = Boolean(config?.removeContentOnCompletion) || Boolean(config?.removeAttachmentsOnCompletion);
  const removeContent = async (channelId: string, messageId: number): Promise<Result<void>> => {
    const deletes: Promise<Result<void>>[] = [];
    if (config?.removeContentOnCompletion) deletes.push(MessageService.deleteContent(channelId, messageId));
    if (config?.removeAttachmentsOnCompletion) deletes.push(MessageService.deleteAttachments(channelId, messageId));
    const results = await Promise.all(deletes);
    return results.find((r) => !r.ok) ?? OK_VOID;
  };
  return {
    createMessage: (channelId, serverId, correlationId) =>
      MessageService.createMessage(channelId, serverId, correlationId),
    createConnectorMessage: (channelId, messageId, metaDataId, name, status) =>
      MessageService.createConnectorMessage(channelId, messageId, metaDataId, name, status as Parameters<typeof MessageService.createConnectorMessage>[4]),
    updateConnectorMessageStatus: (channelId, messageId, metaDataId, status, errorCode) =>
      MessageService.updateConnectorMessageStatus(channelId, messageId, metaDataId, status as Parameters<typeof MessageService.updateConnectorMessageStatus>[3], errorCode),
    storeContent: (channelId, messageId, metaDataId, contentType, content, dataType) => {
      if (!shouldStoreContent(mode, contentType)) {
        return Promise.resolve(OK_VOID);
      }
      let toStore = content;
      if (encrypt) {
        const enc = encryptContent(content);
        // Fail loud: never fall back to storing plaintext when encryption is on.
        if (!enc.ok) return Promise.resolve(fail<void>(enc.error));
        toStore = enc.value;
      }
      return MessageService.storeContent(channelId, messageId, metaDataId, contentType as Parameters<typeof MessageService.storeContent>[3], toStore, dataType, encrypt);
    },
    // markProcessed runs on success and on error/recovery paths, so it must NOT
    // delete content: error content is needed for investigation, and a still-queued
    // destination needs its content to deliver. The pipeline calls
    // removeCompletedContent only on full successful completion.
    markProcessed: (channelId, messageId) => MessageService.markProcessed(channelId, messageId),
    removeCompletedContent: (channelId, messageId) => removeContent(channelId, messageId),
    // A queued delivery finished. The consumer knows one destination, so check
    // the whole message here: content goes only when every connector is done
    // and none failed.
    removeContentIfDelivered: async (channelId, messageId) => {
      if (!removesOnCompletion) return OK_VOID;
      const delivered = await MessageService.isFullyDelivered(channelId, messageId);
      if (!delivered.ok) return fail<void>(delivered.error);
      return delivered.value ? removeContent(channelId, messageId) : OK_VOID;
    },
    isFullyDelivered: (channelId, messageId) => MessageService.isFullyDelivered(channelId, messageId),
    enqueue: (channelId, messageId, metaDataId) =>
      MessageService.enqueue(channelId, messageId, metaDataId),
    loadContent: (channelId, messageId, metaDataId, contentType) =>
      MessageService.loadContent(channelId, messageId, metaDataId, contentType as Parameters<typeof MessageService.loadContent>[3]),
    incrementStats: (channelId, metaDataId, serverId, field) =>
      MessageService.incrementStats(channelId, metaDataId, serverId, field),
    dequeue: (channelId, metaDataId, batchSize, rotate) =>
      MessageService.dequeue(channelId, metaDataId, batchSize, rotate === true),
    release: (channelId, messageId, metaDataId, newStatus) =>
      MessageService.release(channelId, messageId, metaDataId, newStatus as Parameters<typeof MessageService.release>[3]),
    storeAttachment: (channelId, messageId, attachmentId, mimeType, content, size) =>
      MessageService.storeAttachment(channelId, messageId, attachmentId, mimeType, content, size),
    removeContent: (channelId, messageId, metaDataId, contentType) =>
      MessageService.removeContent(channelId, messageId, metaDataId, contentType as Parameters<typeof MessageService.removeContent>[3]),
    storeCustomMetadata: (channelId, messageId, metaDataId, metadata) =>
      MessageService.storeCustomMetadata(channelId, messageId, metaDataId, metadata),
    initializeMessage: (channelId, serverId, connectorName, contentRows, correlationId) => {
      const filtered = contentRows.filter((r) => shouldStoreContent(mode, r.contentType));
      if (!encrypt) {
        return MessageService.initializeMessage(channelId, serverId, connectorName, filtered, correlationId, false);
      }
      // Fail loud: the whole message init fails rather than storing PHI in
      // plaintext under an encryptData channel.
      const encRows: { metaDataId: number; contentType: number; content: string; dataType: string }[] = [];
      for (const r of filtered) {
        const enc = encryptContent(r.content);
        if (!enc.ok) {
          return Promise.resolve(fail<{ messageId: number; correlationId: string }>(enc.error));
        }
        encRows.push({ ...r, content: enc.value });
      }
      return MessageService.initializeMessage(channelId, serverId, connectorName, encRows, correlationId, true);
    },
    finalizeMessage: (channelId, messageId, serverId) =>
      MessageService.finalizeMessage(channelId, messageId, serverId),
  };
}

function toBridgeRecord(v: CollectionRecordResult): {
  id: string; fields: Record<string, string>; payload: string | null; expireAt: string | null; createdAt: string;
} {
  return {
    id: v.id,
    fields: v.fields,
    payload: v.payload,
    expireAt: v.expireAt ? v.expireAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
  };
}

/** Validates script input with Zod; service errors are thrown into the script. */
export function createCollectionBridge(): NonNullable<BridgeDependencies['collections']> {
  return {
    store: async (name, fields, payload, options) => {
      const input = storeRecordSchema.parse({
        fields, payload, expireAt: options.expireAt, ttlSeconds: options.ttlSeconds,
      });
      const result = await CollectionService.store(name, input);
      if (!result.ok) throw new Error(result.error.message);
      return toBridgeRecord(result.value);
    },
    find: async (name, match, options) => {
      const query = findRecordsSchema.parse({
        match, filter: options.filter, latest: options.latest, limit: options.limit, order: options.order,
      });
      const result = await CollectionService.find(name, query);
      if (!result.ok) throw new Error(result.error.message);
      return result.value.map(toBridgeRecord);
    },
    update: async (name, id, changes) => {
      const recordId = collectionRecordIdSchema.parse(id);
      const input = updateRecordSchema.parse(changes);
      const result = await CollectionService.updateByName(name, recordId, input);
      if (!result.ok) throw new Error(result.error.message);
      return result.value ? toBridgeRecord(result.value) : null;
    },
    delete: async (name, id) => {
      const result = await CollectionService.removeByName(name, collectionRecordIdSchema.parse(id));
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  };
}

export function createResourceBridge(): NonNullable<BridgeDependencies['getResource']> {
  return async (name) => {
    const result = await ResourceService.getByName(name);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
}

function createDbQueryBridge(): NonNullable<BridgeDependencies['dbQuery']> {
  return async (dataSourceName, sql, params) => {
    const result = await DataSourceService.runQuery(dataSourceName, sql, params);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
}

/**
 * safeHttpFetch re-checks every resolved address, never follows redirects and
 * caps the response size, so a DNS name or redirect cannot reach a blocked
 * address the hostname check missed.
 */
export function createHttpFetchBridge(): NonNullable<BridgeDependencies['httpFetch']> {
  return (url, options) => safeHttpFetch(url, options, config.SCRIPT_HTTP_ALLOWED_HOSTS);
}

/** Loop guard: routeMessage hops per message chain. */
const MAX_ROUTE_DEPTH = 25;

const routeDepthStore = new AsyncLocalStorage<number>();

/** Why nothing on the destination's queue is sent, or null. */
function whyQueueHeld(dest: ChannelDetail['destinations'][number] | undefined): string | null {
  if (!dest) return 'which the channel no longer has';
  if (!dest.enabled) return 'which is switched off';
  return dest.queueMode === 'NEVER' ? 'whose queue is off' : null;
}

const SILENCE_CHECK_INTERVAL_MS = 30_000;
/** Longest a destination send may take when the connector sets no shorter timeout of its own. */
const SEND_BACKSTOP_MS = 300_000;
const RAW_NOT_STORED = 'Not finished after a server stop: its raw content is not stored, so it cannot be run again. '
  + 'No destination was sent to, but its scripts may have run. Check whether the channel has received it again before you send it again.';
/** How long an undeploy waits for crash recovery to end the messages it was working on. */
const RECOVERY_ENDS_MS = 10_000;

type TlsResolver = (props: Readonly<Record<string, unknown>>) => Promise<Result<Record<string, unknown>>>;
interface SourceFailureReport {
  readonly channelId: string;
  readonly runtime: ChannelRuntime;
  readonly error: Error;
  readonly raiseAlert: (event: Parameters<AlertManager['handleEvent']>[0]) => Promise<void>;
}

const SOURCE_TLS_RESOLVERS: Readonly<Record<string, TlsResolver>> = { HTTP: resolveHttpSourceTls, KAFKA: resolveQueueTls, AMQP: resolveQueueTls };
const DESTINATION_TLS_RESOLVERS: Readonly<Record<string, TlsResolver>> = { HTTP: resolveHttpDestinationTls, KAFKA: resolveQueueTls, AMQP: resolveQueueTls };

export class EngineManager {
  private readonly runtimes = new Map<string, DeployedChannel>();
  private readonly sandbox: SandboxExecutor;
  private readonly serverId: string;
  private silenceTimer: ReturnType<typeof setInterval> | undefined;
  /** Shared by every channel. */
  private globalMap: Promise<GlobalMapProxy> | undefined;
  private readonly deploying = new Set<string>();
  /** The messages and recoveries still being worked on, by channel, whichever deployment of it began them. */
  private readonly working = new Map<string, Set<Promise<void>>>();

  constructor(serverId?: string) {
    this.sandbox = new VmSandboxExecutor({
      collections: createCollectionBridge(),
      getResource: createResourceBridge(),
      httpFetch: createHttpFetchBridge(),
      httpAllowedHosts: config.SCRIPT_HTTP_ALLOWED_HOSTS,
      dbQuery: createDbQueryBridge(),
      routeMessage: this.createRouteMessageBridge(),
    });
    this.serverId = serverId ?? 'server-01';
  }

  private resolveChannelIdByName(name: string): string | undefined {
    for (const [id, deployed] of this.runtimes) {
      if (deployed.config.name === name) return id;
    }
    return undefined;
  }

  /**
   * Route a raw message into another deployed, STARTED channel by name. Enforces a
   * hop-depth cap so a routing cycle (A→B→A) fails loud instead of recursing until
   * timeout on every hop.
   */
  async routeMessage(channelName: string, rawData: string): Promise<Result<SourceDispatchOutcome>> {
    return tryCatch(async () => {
      // Depth is tracked per message chain (AsyncLocalStorage follows the awaited
      // routeMessage -> processMessage -> script -> routeMessage path), so
      // concurrent unrelated messages never count against each other.
      const depth = routeDepthStore.getStore() ?? 0;
      if (depth >= MAX_ROUTE_DEPTH) {
        throw new Error(`routeMessage exceeded max hop depth (${String(MAX_ROUTE_DEPTH)}) — possible routing loop`);
      }
      const targetId = this.resolveChannelIdByName(channelName);
      if (!targetId) {
        throw new Error(`routeMessage: no deployed channel named "${channelName}"`);
      }
      const result = await routeDepthStore.run(depth + 1, () => this.sendMessage(targetId, rawData));
      if (!result.ok) throw new Error(result.error.message);
      // The target took the message but could not process it. That is a failed
      // route, not a success: the calling script must be able to see it.
      if (result.value.status === DISPATCH_STATUS.ERROR) {
        throw new Error(`routeMessage: channel "${channelName}" recorded message ${String(result.value.messageId)} with an ERROR status`);
      }
      return result.value;
    });
  }

  private createRouteMessageBridge(): NonNullable<BridgeDependencies['routeMessage']> {
    return async (channelName, rawData) => {
      const result = await this.routeMessage(channelName, rawData);
      if (!result.ok) throw new Error(result.error.message);
      const { messageId, status, response } = result.value;
      const filtered = status === DISPATCH_STATUS.FILTERED;
      return response === undefined ? { success: true, messageId, filtered } : { success: true, messageId, filtered, response };
    };
  }

  /**
   * The bundle's channel has its configuration map references resolved.
   * Nothing a save changes is read from the database here, so a recorded
   * deployment runs as it was deployed (#225).
   */
  async deploy(bundle: DeploymentBundle): Promise<void> {
    const { channel } = bundle;
    if (this.runtimes.has(channel.id)) {
      throw new Error(`Channel ${channel.id} is already deployed`);
    }
    // Deploy awaits many things before the runtime is registered, so two
    // requests for the same channel could otherwise both get this far and
    // open the same port twice.
    if (this.deploying.has(channel.id)) {
      throw new Error(`Channel ${channel.id} is already being deployed`);
    }
    this.deploying.add(channel.id);
    try {
      await this.deployChannel(bundle);
    } finally {
      this.deploying.delete(channel.id);
    }
  }

  private async deployChannel(bundle: DeploymentBundle): Promise<void> {
    const { channel } = bundle;

    // Fail loud, never silent: a channel that asks for at-rest encryption must
    // not deploy (and store PHI as plaintext) when no key is configured.
    if (channel.encryptData && !isContentEncryptionConfigured()) {
      throw new Error(
        `Channel ${channel.id} has encryptData enabled but CONTENT_ENCRYPTION_KEY is not configured. ` +
        'Refusing to deploy — message content would be stored in plaintext. ' +
        'Set CONTENT_ENCRYPTION_KEY (64 hex chars) or disable encryptData on the channel.',
      );
    }

    // Fail loud, never silent: a queued destination needs stored RAW+SENT content
    // to deliver and to recover after a crash. Any other storage mode never writes
    // SENT, so every queued message would error on delivery.
    const storageMode = channel.messageStorageMode as MessageStorageMode;
    const hasQueuedDestination = channel.destinations.some((d) => d.queueMode !== 'NEVER');
    if (hasQueuedDestination && !storageModeSupportsQueue(storageMode)) {
      throw new Error(
        `Channel ${channel.id} has a queued destination but message storage mode is ${storageMode}, ` +
        'which does not persist the RAW/SENT content required to deliver and recover queued messages. ' +
        `Use ${Object.values(MESSAGE_STORAGE_MODE).filter(storageModeSupportsQueue).join(' or ')} storage, or set every destination queue mode to NEVER.`,
      );
    }

    const runtime = new ChannelRuntime();
    const gcm = new GlobalChannelMap();

    const store = createMessageStoreAdapter({
      messageStorageMode: storageMode,
      removeContentOnCompletion: channel.removeContentOnCompletion,
      removeAttachmentsOnCompletion: channel.removeAttachmentsOnCompletion,
      encryptData: channel.encryptData,
    });

    // Cert-ID references resolve to PEM here, since connectors have no DB access.
    // Fail loud: a channel never deploys without the TLS it was configured for.
    let sourceProperties: Record<string, unknown> = channel.sourceConnectorProperties;
    const resolveSourceTls = SOURCE_TLS_RESOLVERS[channel.sourceConnectorType];
    if (resolveSourceTls) {
      const resolved = await resolveSourceTls(sourceProperties);
      if (!resolved.ok) {
        throw new Error(`Channel ${channel.id} source TLS resolution failed: ${resolved.error.message}`);
      }
      sourceProperties = resolved.value;
    }
    const connectorEnv = { fileRoots: buildFileRoots(config.FILE_CONNECTOR_ROOTS), channelId: channel.id };
    const source = createSourceConnector(
      channel.sourceConnectorType,
      sourceProperties,
      connectorEnv,
    ) as SourceConnectorRuntime;

    const destinations = new Map<number, DestinationConnectorRuntime>();
    for (const dest of channel.destinations) {
      let destProperties: Record<string, unknown> = dest.properties;
      const resolveDestTls = DESTINATION_TLS_RESOLVERS[dest.connectorType];
      if (resolveDestTls) {
        const resolved = await resolveDestTls(destProperties);
        if (!resolved.ok) {
          throw new Error(`Channel ${channel.id} destination ${dest.metaDataId} TLS resolution failed: ${resolved.error.message}`);
        }
        destProperties = resolved.value;
      }
      const connector = createDestinationConnector(
        dest.connectorType,
        destProperties,
        connectorEnv,
      );
      destinations.set(dest.metaDataId, connector);
    }

    // Alerts, the configuration map and the global map are server settings,
    // read live at every deploy; the channel's own code comes from the bundle.
    const [loadedAlerts, configMapResult, globalMapProxyInstance] = await Promise.all([
      this.loadAlertsForChannel(channel.id),
      ConfigMapService.list(),
      this.sharedGlobalMap(channel.id),
    ]);

    // Fail loud, never silent: a channel deployed without its config map or
    // global map would run with different behaviour from the one it was configured with.
    if (!configMapResult.ok) throw deployLoadError(channel.id, 'the configuration map', configMapResult.error);

    const templates = templateData(bundle);
    const filterTransformerData = filterTransformerDataOf(channel);

    const scripts = await this.compileChannelScripts(
      channel, templates, bundle.globalScripts, filterTransformerData,
    );

    const destConfigs: DestinationConfig[] = await this.buildDestinationConfigs(
      channel, templates, filterTransformerData,
    );

    const emailSender = async (to: readonly string[], subject: string, body: string): Promise<void> => {
      const result = await EmailService.sendMail(to, subject, body);
      if (!result.ok) {
        logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to send alert email');
      }
      // An alert can carry message details out by email: who it went to, never what it said (D-312).
      emitAuditEvent({
        action: AUDIT_ACTION.ALERT_SENT, outcome: result.ok ? 'SUCCESS' : 'FAILURE',
        channelId: channel.id, attributes: { recipients: [...to] },
      });
    };

    const channelSender = async (targetChannelId: string, content: string): Promise<void> => {
      if (targetChannelId === channel.id) {
        throw new Error('An alert cannot be sent into the channel it is about');
      }
      const target = this.runtimes.get(targetChannelId);
      if (!target || target.runtime.getState() !== 'STARTED') {
        throw new Error(`Alert target channel ${targetChannelId} is not deployed and started`);
      }
      const sent = await target.processMessage(content, { alertSourceChannelId: channel.id });
      if (!sent.ok) throw sent.error;
    };

    const alertManager = new AlertManager({ logger, emailSender, channelSender, channelName: channel.name });
    alertManager.loadAlerts(loadedAlerts);

    // Alerts are sent in the background. Awaiting them made every failing
    // message wait on the mail server, and the sender on the message.
    const raiseAlert: AlertEventHandler = (event) => {
      alertManager.handleEvent(event).catch((error: unknown) => {
        logger.error({ channelId: channel.id, errMsg: error instanceof Error ? error.message : String(error) }, 'Alert handling failed');
      });
      return Promise.resolve();
    };

    // A Kafka or AMQP source stops itself when a message keeps failing to store;
    // the channel must not then look STARTED while nothing is read.
    // The runtime identifies this deployment (and its source): a report that
    // arrives after an undeploy and redeploy must not stop the new one.
    source.setFatalHandler?.((error) => { void this.stopAfterSourceFailure({ channelId: channel.id, runtime, error, raiseAlert }); });

    const configMapRecord: Record<string, unknown> = {};
    for (const entry of configMapResult.value) {
      configMapRecord[`${entry.category}.${entry.name}`] = entry.value;
    }
    const maps: ChannelMaps = { gcm, globalMap: globalMapProxyInstance, configMap: Object.freeze(configMapRecord) };

    // JavaScript connectors run their scripts with the same code templates and
    // maps as the rest of the channel (compiled once, here).
    await this.wireJavaScriptSource(channel, source, templates, maps);
    await this.wireJavaScriptDestinations(channel, destinations, templates, maps);

    // Deploy scripts set the channel up (lookup tables, counters), so a channel
    // whose deploy script failed must not start half-configured: fail the deploy.
    if (scripts.globalDeploy) {
      await this.runDeployScript(scripts.globalDeploy, channel, maps, 'global deploy');
    }
    if (scripts.deploy) {
      await this.runDeployScript(scripts.deploy, channel, maps, 'deploy');
    }

    const messageFor = (metaDataId: number, messageId: number, content: string): ConnectorMessage => ({
      channelId: channel.id, messageId, metaDataId, content, dataType: channel.inboundDataType,
    });
    const variablesUsed: VariablesUsed = (metaDataId, messageId, content) =>
      destinations.get(metaDataId)?.variablesUsed(messageFor(metaDataId, messageId, content)) ?? [];

    const pipelineConfig: PipelineConfig = {
      channelId: channel.id,
      serverId: this.serverId,
      dataType: channel.inboundDataType,
      dataTypeOptions: dataTypeOptionsFor(channel),
      scripts,
      destinations: destConfigs,
      globalChannelMap: gcm,
      globalMapProxy: globalMapProxyInstance,
      configMap: maps.configMap,
      scriptTimeoutMs: channel.scriptTimeoutSeconds * 1_000,
      responseSource: toResponseSource(channel.responseMode, channel.responseConnectorName),
      metadataColumns: channel.metadataColumns.flatMap((c) =>
        c.mappingExpression ? [{ name: c.name, dataType: c.dataType, mapping: c.mappingExpression }] : []),
      variablesUsed,
      onError: raiseAlert,
      onStoreFailure: logStoreFailure,
      onTiming: logger.level === 'debug' || logger.level === 'trace'
        ? (messageId, totalMs, stages) => {
            logger.debug(
              { channelId: channel.id, channelName: channel.name, messageId, totalMs, stages },
              'Pipeline timing',
            );
          }
        : undefined,
    };

    const sendFn: SendToDestination = async (metaDataId, messageId, content, signal, correlationId, variables) => {
      const connector = destinations.get(metaDataId);
      if (!connector) {
        return tryCatch(() => { throw new Error(`Destination ${String(metaDataId)} not found`); });
      }
      // As the pipeline sends them: an empty set, which the queue and recovery read from the store, is none.
      const sent = variables && Object.keys(variables).length > 0 ? variables : undefined;
      // Connectors apply their own configured timeouts; this is the backstop
      // that keeps a send from hanging forever if one does not.
      return connector.send(
        { ...messageFor(metaDataId, messageId, content), correlationId, variables: sent },
        AbortSignal.any([signal, AbortSignal.timeout(SEND_BACKSTOP_MS)]),
      );
    };

    const queueConsumers: QueueConsumer[] = [];
    for (const dest of channel.destinations) {
      if (whyQueueHeld(dest) !== null) continue;
      const queueConfig: QueueConsumerConfig = {
        channelId: channel.id,
        metaDataId: dest.metaDataId,
        serverId: this.serverId,
        retryCount: dest.retryCount ?? 0,
        rotate: dest.rotateQueue === true,
        retryIntervalMs: dest.retryIntervalMs ?? 10_000,
        batchSize: 10,
        pollIntervalMs: 1_000,
        onError: raiseAlert,
        onStoreFailure: logStoreFailure,
        // A source that keeps its input until every destination delivered (DICOM).
        onMessageDelivered: source.onMessageDelivered
          ? (_messageId, rawContent) => source.onMessageDelivered?.(rawContent) ?? Promise.resolve()
          : undefined,
      };
      queueConsumers.push(new QueueConsumer(queueConfig, store, sendFn));
    }

    const processor = new MessageProcessor(
      this.sandbox, store, sendFn, pipelineConfig, DEFAULT_EXECUTION_OPTIONS,
    );

    // A response from a destination that does not exist would leave every
    // sender without the answer it waits for, with nothing logged.
    if (channel.responseMode === 'DESTINATION' && !channel.destinations.some((d) => d.name === channel.responseConnectorName)) {
      throw new ServiceError('INVALID_INPUT', `Channel ${channel.name}: it responds from destination "${channel.responseConnectorName ?? ''}", which it does not have`);
    }
    // A source with Mirth's "Process Batch" on splits what it receives into
    // messages. Only HL7v2 batches can be split; any other data type refuses
    // to deploy rather than treat a whole batch as one message.
    const batched = channel.sourceConnectorProperties['processBatch'] === true;
    if (batched && channel.inboundDataType !== 'HL7V2') {
      throw new ServiceError('INVALID_INPUT', `Channel ${channel.name}: batch processing is only supported for HL7V2, not ${channel.inboundDataType}`);
    }

    // Used by the source connector and the sendMessage API.
    const activity = { lastAt: Date.now() };
    const processOne = async (rawContent: string, sourceMap?: Record<string, unknown>, received?: ReceivedMessage, onStored?: () => void): Promise<Result<SourceDispatchOutcome>> => {
      activity.lastAt = Date.now();
      // Channel-to-channel routing sets it.
      const correlationId = typeof sourceMap?.['correlationId'] === 'string'
        ? sourceMap['correlationId'] as string
        : undefined;
      const result = await processor.processMessage(
        { rawContent, sourceMap: sourceMap ?? {}, correlationId, received, onStored },
        // Aborted by a halt, which cancels the scripts and sends in progress.
        // There is no deadline for the message as a whole: each script is
        // limited by the channel's script timeout and each send by its
        // connector's timeout.
        runtime.haltSignal,
      );
      if (!result.ok) return result;
      // Surface the pipeline's final status so the source connector can build the
      // right response (MLLP: PROCESSED→AA, ERROR→AE, FILTERED→AA), as the
      // channel's response mode defines it.
      return { ok: true, value: toSourceOutcome(result.value, channel.responseMode), error: null };
    };
    const processMessage = (rawContent: string, sourceMap?: Record<string, unknown>): Promise<Result<SourceDispatchOutcome>> =>
      this.track(channel.id, processOne(rawContent, sourceMap));

    const runtimeConfig: ChannelRuntimeConfig = {
      channelId: channel.id,
      source,
      destinations,
      onMessage: async (raw) => (batched
        ? processBatch(splitHl7Batch, raw.content, (part) => processMessage(part, raw.sourceMap))
        : this.track(channel.id, processOne(raw.content, raw.sourceMap, undefined, () => raw.onStored?.({ recoverable: shouldStoreContent(storageMode, CONTENT_TYPE.RAW) })))),
    };

    // Taken before the channel can receive anything: every unprocessed message
    // up to this id was left by an earlier run.
    const recoveryHorizon = await MessageService.getLatestMessageId(channel.id);
    const earlierWork = [...(this.working.get(channel.id) ?? [])];

    const result = await runtime.deploy(runtimeConfig);
    if (!result.ok) {
      throw new Error(`Failed to deploy channel runtime: ${result.error.message}`);
    }

    // Recover messages left unprocessed by a prior crash/restart on the first
    // start. Best-effort: failures are logged, never allowed to abort a start.
    // Claims a queue consumer held when the server stopped go back to QUEUED.
    // This must finish before the consumers start: reset afterwards, it would
    // also release a message a consumer had just claimed, and send it twice.
    let claimsReset = false;
    const resetClaimsOnce = async (): Promise<void> => {
      if (claimsReset) return;
      claimsReset = true;
      const queues = await MessageService.waitingByDestination(channel.id);
      if (!queues.ok) {
        logger.error({ channelId: channel.id, errMsg: queues.error.message }, 'Could not read which destinations messages wait for');
      }
      for (const { metaDataId } of queues.ok ? queues.value : channel.destinations) {
        const reset = await MessageService.resetPending(channel.id, metaDataId);
        if (!reset.ok) {
          logger.error({ channelId: channel.id, metaDataId, errMsg: reset.error.message }, 'Failed to reset PENDING messages');
        }
      }
    };

    let heldReported = false;
    let recovered = false;
    let recovering = Promise.resolve();
    const recoverOnce = (): Promise<void> => {
      const { runSignal, haltSignal } = runtime;
      const run = async (): Promise<void> => {
        if ((recovered && heldReported) || !(await this.earlierWorkEnds(channel.id, earlierWork, { runSignal, raiseAlert }))) return;
        recovered ||= await this.recoverChannel({
          channel, store, runAgain: (message, raw, sourceMap) => processOne(raw, sourceMap, message), sendFn, destinations: destConfigs, variablesUsed, raiseAlert, horizon: recoveryHorizon, runSignal, haltSignal,
        });
        // Only then: recovery, and what an earlier deployment was sending, may have put some on a queue.
        heldReported ||= recovered && await this.reportHeldQueues(channel, raiseAlert);
      };
      // An interrupted one may still be ending its sends.
      recovering = this.track(channel.id, recovering.then(run, run));
      runtime.runInBackground(recovering);
      return recovering;
    };

    this.runtimes.set(channel.id, { channelId: channel.id, runtime, config: channel, globalChannelMap: gcm, globalMapProxy: globalMapProxyInstance, configMap: maps.configMap, alertManager, queueConsumers, scripts, processMessage, variablesUsed, recoverOnce, resetClaimsOnce, activity });
    this.silenceTimer ??= setInterval(() => { void this.checkSilentChannels(); }, SILENCE_CHECK_INTERVAL_MS).unref();
  }

  /**
   * Their messages are kept, and the data pruner leaves them alone; nobody would otherwise hear that
   * they wait. False when that could not be read.
   */
  private async reportHeldQueues(channel: ChannelDetail, raiseAlert: AlertEventHandler): Promise<boolean> {
    const queues = await MessageService.waitingByDestination(channel.id);
    if (!queues.ok) {
      logger.error({ channelId: channel.id, errMsg: queues.error.message }, 'Could not read whether messages wait on a queue that nothing is sent from');
      return false;
    }
    const held: string[] = [];
    for (const { metaDataId, waiting, notKnown } of queues.value) {
      const destination = channel.destinations.find((d) => d.metaDataId === metaDataId);
      const queueHeld = whyQueueHeld(destination);
      const count = queueHeld === null ? notKnown : waiting;
      if (count === 0) continue;
      const why = queueHeld ?? 'put there before destinations kept their numbers, so it is not known that they are for it';
      held.push(`${String(count)} for ${destination ? `"${destination.name}"` : `destination ${String(metaDataId)}`}, ${why}`);
      logger.error({ channelId: channel.id, metaDataId, waiting: count, why }, 'Messages wait on a queue and are kept, not sent');
      emitEvent({
        level: 'WARN', name: EVENT_NAME.QUEUE_HELD, outcome: 'SUCCESS', userId: null, channelId: channel.id,
        serverId: null, ipAddress: null, attributes: { metaDataId, waiting: count, destination: destination?.name ?? null, why },
      });
    }
    // One alert: an alert is sent at most once a minute.
    if (held.length > 0) {
      await raiseAlert({ channelId: channel.id, errorType: 'DESTINATION_CONNECTOR', errorMessage: `Messages wait on a queue and are kept, not sent: ${held.join('; ')}`, timestamp: Date.now() });
    }
    return true;
  }

  private track<T>(channelId: string, work: Promise<T>): Promise<T> {
    const working = this.working.get(channelId) ?? new Set<Promise<void>>();
    this.working.set(channelId, working);
    const ended = (): void => { working.delete(tracked); };
    const tracked: Promise<void> = work.then(ended, ended);
    working.add(tracked);
    return work;
  }

  /**
   * A message that an earlier deployment is still working on is unprocessed too, and recovering it
   * would send it twice. False when the channel began to stop first: recovery is then for the next start.
   */
  private async earlierWorkEnds(
    channelId: string,
    earlierWork: readonly Promise<void>[],
    { runSignal, raiseAlert }: Pick<ChannelRecovery, 'runSignal' | 'raiseAlert'>,
  ): Promise<boolean> {
    if (earlierWork.length === 0) return true;
    while (!(await settleWithin(Promise.all(earlierWork), SEND_BACKSTOP_MS, runSignal))) {
      if (runSignal.aborted) return false;
      const errorMessage = 'Crash recovery is waiting: an earlier deployment of the channel is still sending a message. If that never ends, restart the server';
      logger.error({ channelId }, errorMessage);
      await raiseAlert({ channelId, errorType: 'DESTINATION_CONNECTOR', errorMessage, timestamp: Date.now() });
    }
    return true;
  }

  /**
   * Stops the channel (queue consumers too, as a stop from the UI does) so the
   * dashboard shows it stopped. The failed message stays on its queue or topic
   * until an operator fixes the cause and starts the channel again.
   */
  private async stopAfterSourceFailure(report: SourceFailureReport): Promise<void> {
    const { channelId, runtime, error, raiseAlert } = report;
    const deployed = this.runtimes.get(channelId);
    const state = runtime.getState();
    // Only the running deployment that registered the handler may stop the
    // channel; a late report from a stopped or replaced one is logged and dropped.
    if (!deployed || deployed.runtime !== runtime || (state !== 'STARTED' && state !== 'PAUSED')) {
      logger.warn({ channelId, state, errMsg: error.message }, 'Ignoring a fatal source report from a source that is no longer running');
      return;
    }
    logger.error({ channelId, errMsg: error.message }, 'Source connector stopped after a fatal error; stopping the channel');
    emitEvent({
      level: 'ERROR', name: 'CHANNEL_STOPPED', outcome: 'FAILURE', userId: null, channelId,
      serverId: null, ipAddress: null, attributes: { reason: 'SOURCE_FAILED', error: error.message },
    });
    await raiseAlert({ channelId, errorType: 'SOURCE_CONNECTOR', errorMessage: error.message, timestamp: Date.now() });

    await Promise.all(deployed.queueConsumers.map((c) => c.stop()));
    const stopped = await deployed.runtime.stop();
    if (!stopped.ok) {
      logger.error({ channelId, errMsg: stopped.error.message }, 'Could not stop the channel after its source failed');
    }
    emitToChannelAudience(channelId, SOCKET_EVENT.CHANNEL_STATE, { channelId, state: deployed.runtime.getState() });
  }

  /**
   * A channel that is not STARTED restarts its silence clock, so stopping it
   * never alerts and a restart gets a full window before the first alert.
   */
  async checkSilentChannels(now: number = Date.now()): Promise<void> {
    for (const deployed of this.runtimes.values()) {
      if (deployed.runtime.getState() !== 'STARTED') {
        deployed.activity.lastAt = now;
        continue;
      }
      try {
        await deployed.alertManager.checkSilence(deployed.channelId, deployed.activity.lastAt, now);
      } catch (err) {
        logger.error({ errMsg: err instanceof Error ? err.message : String(err), channelId: deployed.channelId }, 'NO_MESSAGES alert check failed');
      }
    }
  }

  getRuntime(channelId: string): DeployedChannel | undefined {
    return this.runtimes.get(channelId);
  }

  getAll(): ReadonlyMap<string, DeployedChannel> {
    return this.runtimes;
  }

  /** NOT_FOUND when not deployed, CONFLICT when not STARTED or not processed; the send-message API maps them to HTTP statuses. */
  async sendMessage(channelId: string, content: string): Promise<Result<SourceDispatchOutcome>> {
    return tryCatch(async () => {
      const deployed = this.runtimes.get(channelId);
      if (!deployed) {
        throw new ServiceError('NOT_FOUND', `Channel ${channelId} is not deployed`);
      }
      const state = deployed.runtime.getState();
      if (state !== 'STARTED') {
        throw new ServiceError('CONFLICT', `Channel is ${state}, must be STARTED to receive messages`);
      }
      const result = await deployed.processMessage(content);
      if (!result.ok) {
        throw new ServiceError('CONFLICT', result.error.message);
      }
      return result.value;
    });
  }

  async undeploy(channelId: string): Promise<void> {
    const deployed = this.runtimes.get(channelId);
    if (!deployed) {
      throw new Error(`Channel ${channelId} is not deployed`);
    }

    // Stop queue consumers before the connectors: stop() waits for the send in
    // flight, so no queued delivery fails (and burns a retry) because its
    // destination was stopped underneath it.
    await Promise.all(deployed.queueConsumers.map((c) => c.stop()));

    // Stop first: runtime.undeploy() requires STOPPED, and undeploy must never
    // throw on a STARTED channel (that would sever in-flight messages and skip
    // the rest of the teardown).
    const state = deployed.runtime.getState();
    if (state === 'STARTED' || state === 'PAUSED') {
      const stopResult = await deployed.runtime.stop();
      if (!stopResult.ok) {
        // Fall back to a force-halt so teardown can still proceed.
        await deployed.runtime.halt();
      }
    }

    // A halt does not wait for recovery, and its sends are to end before their destinations are undeployed.
    if (!(await deployed.runtime.backgroundEnds(RECOVERY_ENDS_MS))) {
      logger.error({ channelId }, 'Undeploying a channel whose crash recovery is still sending a message');
    }
    // Nothing has been torn down yet.
    if (deployed.runtime.getState() !== 'STOPPED') {
      throw new ServiceError('CONFLICT', `Cannot undeploy: channel is ${deployed.runtime.getState()}`);
    }

    // A failing undeploy script is logged and the teardown carries on: refusing
    // to undeploy would leave a channel nobody can stop.
    const maps: ChannelMaps = { gcm: deployed.globalChannelMap, globalMap: deployed.globalMapProxy, configMap: deployed.configMap };
    for (const [script, name] of [[deployed.scripts.undeploy, 'undeploy'], [deployed.scripts.globalUndeploy, 'global undeploy']] as const) {
      if (!script) continue;
      try {
        await this.runDeployScript(script, deployed.config, maps, name);
      } catch (error) {
        logger.error({ errMsg: error instanceof Error ? error.message : String(error), channelId }, 'Undeploy script failed; continuing with undeploy');
      }
    }

    deployed.globalChannelMap.clear();
    deployed.alertManager.clearThrottleState();
    // The global map belongs to every channel, so save it but keep it running.
    await deployed.globalMapProxy.flush();

    const result = await deployed.runtime.undeploy();
    if (!result.ok) {
      throw new Error('Failed to undeploy channel runtime');
    }

    this.runtimes.delete(channelId);
  }

  /**
   * Recover unprocessed messages for a freshly deployed channel.
   *
   * - Stale PENDING claims (in-flight dispatches interrupted by a crash) are reset
   *   to QUEUED so the queue consumers redeliver them.
   * - A message not routed yet is run again from its stored raw content, as the same message. Without
   *   that it ends in ERROR.
   * - RECEIVED destination messages are redispatched from their stored SENT content and variables.
   * QUEUED messages are left for the queue consumers.
   * Resolves false when it is to go on at the next start.
   */
  private async recoverChannel(recovery: ChannelRecovery): Promise<boolean> {
    const { channel, store, runAgain, horizon, runSignal } = recovery;
    // Without the horizon there is no telling a leftover message from one the
    // running channel is working on right now, and recovering the latter would
    // process it twice. Skip, and say so.
    if (!horizon.ok) {
      logger.error({ channelId: channel.id, errMsg: horizon.error.message }, 'Channel recovery skipped: could not read the newest message id at deploy');
      return true;
    }
    const maxId = horizon.value;

    const recoveryStore: RecoveryStore = {
      getUnprocessedMessages: async (channelId, afterId, limit) => {
        const r = await MessageService.getUnprocessedMessages(channelId, { afterId, maxId }, limit);
        if (!r.ok) return r;
        return { ok: true, value: r.value.map((m) => ({ messageId: m.id, channelId: m.channelId })), error: null };
      },
      getConnectorMessages: (channelId, messageId) => MessageService.getConnectorMessages(channelId, messageId),
      markProcessed: (channelId, messageId) => MessageService.markProcessed(channelId, messageId),
      finishSource: async (channelId, messageId, status) => {
        const updated = await store.updateConnectorMessageStatus(channelId, messageId, 0, status);
        if (!updated.ok) return updated;
        return store.incrementStats(channelId, 0, this.serverId, status === 'SENT' ? 'sent' : 'errored');
      },
    };

    // Empty under a storage mode that does not keep it. One that cannot be read is not
    // taken as empty: scripts that read it would route or fill the message differently.
    const loadSourceMap = async (channelId: string, messageId: number): Promise<Result<Record<string, unknown>>> => {
      const stored = await store.loadContent(channelId, messageId, 0, CONTENT_TYPE.SOURCE_MAP);
      if (!stored.ok) return fail(stored.error);
      try {
        const parsed: unknown = stored.value === null ? {} : JSON.parse(stored.value);
        return { ok: true, value: isPlainObject(parsed) ? parsed : {}, error: null };
      } catch {
        // Not the parser's own message, which quotes the text: a source map can hold PHI.
        return { ok: false, value: null, error: new Error('Its stored source map is not valid JSON') } as Result<Record<string, unknown>>;
      }
    };

    let toldOfUnstored = false;
    const reprocessSource = async (channelId: string, messageId: number): Promise<Result<void>> => {
      const leave = (error: Error): Result<void> => {
        logger.error({ channelId, messageId, errMsg: error.message }, 'Crash recovery could not run a message again and left it as it was');
        return { ok: false, value: null, error } as Result<void>;
      };
      const raw = await store.loadContent(channelId, messageId, 0, CONTENT_TYPE.RAW);
      if (!raw.ok) return leave(raw.error);
      if (raw.value === null) {
        if (runSignal.aborted) return INTERRUPTED;
        const given = await this.giveUpUnstored(recovery, messageId);
        if (!given.ok) return leave(given.error);
        // One for all of them: an alert is sent at most once a minute.
        if (!toldOfUnstored) {
          toldOfUnstored = true;
          await recovery.raiseAlert({
            channelId, errorType: 'SOURCE_CONNECTOR', timestamp: Date.now(),
            errorMessage: `Crash recovery marked message ${String(messageId)} ERROR; the server log names each one it does that to. ${RAW_NOT_STORED}`,
          });
        }
        return { ok: false, value: null, error: new Error(RAW_NOT_STORED) } as Result<void>;
      }
      const sourceMap = await loadSourceMap(channelId, messageId);
      if (!sourceMap.ok) return leave(sourceMap.error);
      if (runSignal.aborted) return INTERRUPTED;
      const received = await MessageService.resetToReceived(channelId, messageId);
      if (!received.ok) return leave(received.error);
      if (runSignal.aborted) return INTERRUPTED;
      logger.info({ channelId, messageId }, 'Running a message again that a server stop interrupted');
      const processed = await runAgain(received.value, raw.value, sourceMap.value);
      return processed.ok ? OK_VOID : { ok: false, value: null, error: processed.error } as Result<void>;
    };

    const redispatcher = this.redispatcherFor(recovery);
    const redispatchDestination: RedispatchDestinationFn = async (channelId, destination) => {
      const result = await redispatcher.redispatch(destination);
      if (!result.ok && !runSignal.aborted) {
        const { messageId, metaDataId } = destination;
        logger.error({ channelId, messageId, metaDataId, errMsg: result.error.message }, 'Crash recovery left a destination as it was; the next deployment recovers it');
      }
      return result;
    };

    const manager = new RecoveryManager(recoveryStore, reprocessSource, redispatchDestination);
    const recovered = await manager.recover(channel.id, runSignal);
    if (!recovered.ok) {
      logger.error({ channelId: channel.id, errMsg: recovered.error.message }, 'Channel recovery failed; it goes on at the next start');
      return false;
    }
    const { interrupted, ...summary } = recovered.value;
    if (interrupted) {
      logger.info({ channelId: channel.id, ...summary }, 'Channel recovery interrupted by a stop; it goes on at the next start');
    } else if (summary.recovered > 0 || summary.errors > 0) {
      logger.info({ channelId: channel.id, ...summary }, 'Channel recovery complete');
    }
    return !interrupted;
  }

  private async giveUpUnstored({ channel, store }: ChannelRecovery, messageId: number): Promise<Result<void>> {
    const channelId = channel.id;
    const failed = await MessageService.failUnrouted(channelId, messageId);
    if (!failed.ok) return failed;
    logger.error({ channelId, messageId, reason: RAW_NOT_STORED }, 'Crash recovery could not run a message again and marked it ERROR');
    const saved = (what: string, write: Promise<Result<unknown>>): Promise<void> =>
      reportUnsaved([write], { channelId, messageId, metaDataId: 0, what }, logStoreFailure);
    await Promise.all([
      saved('why a message failed', store.storeContent(channelId, messageId, 0, CONTENT_TYPE.PROCESSING_ERROR, RAW_NOT_STORED, 'TEXT')),
      saved('the count of a failed message', store.incrementStats(channelId, 0, this.serverId, 'errored')),
    ]);
    return OK_VOID;
  }

  private redispatcherFor(recovery: ChannelRecovery): DestinationRedispatcher {
    const { channel, store, sendFn, destinations, variablesUsed, raiseAlert, runSignal, haltSignal } = recovery;
    return new DestinationRedispatcher({
      channelId: channel.id,
      serverId: this.serverId,
      store,
      send: sendFn,
      destinations,
      isForItsNumber: (messageId, metaDataId) => MessageService.isForItsNumber(channel.id, messageId, metaDataId),
      variablesUsed,
      runSignal,
      haltSignal,
      onError: raiseAlert,
      onFailed: (messageId, metaDataId, reason) => {
        logger.error({ channelId: channel.id, messageId, metaDataId, ...(reason === null ? {} : { reason }) }, 'Crash recovery could not deliver a message and marked the destination ERROR');
      },
      onStoreFailure: logStoreFailure,
    });
  }

  private async compileWithTemplates(
    source: string,
    context: string,
    templates: ReadonlyArray<CodeTemplateData>,
    sourcefile: string,
  ): Promise<CompiledScript> {
    const withTemplates = prependTemplates(source, templates, context);
    const result = await compileScript(withTemplates, { sourcefile });
    // Fail loud, never silent: returning nothing here would deploy the channel
    // without this filter, transformer or script, and let PHI through untouched.
    if (!result.ok) {
      throw new ServiceError('INVALID_INPUT', `Script ${sourcefile} failed to compile (it includes the code templates for ${context}): ${result.error.message}`);
    }
    return result.value;
  }

  private async compileChannelScripts(
    channel: ChannelDetail,
    templates: ReadonlyArray<CodeTemplateData>,
    gs: GlobalScripts,
    ftData: FilterTransformerData,
  ): Promise<ChannelScripts> {
    const scripts: Record<string, CompiledScript | undefined> = {};

    for (const script of channel.scripts) {
      if (!script.script) continue;
      const key = script.scriptType.toLowerCase();
      if (key === 'preprocessor' || key === 'postprocessor' || key === 'deploy' || key === 'undeploy') {
        scripts[key] = await this.compileWithTemplates(
          script.script, key, templates, `${channel.name}/${key}.ts`,
        );
      }
    }

    const sourceFilterScript = unwrapGenerated(compileFilterRulesToScript(ftData.sourceFilterRules), `${channel.name} source filter`);
    if (sourceFilterScript) {
      scripts['sourceFilter'] = await this.compileWithTemplates(
        sourceFilterScript, 'sourceFilter', templates, `${channel.name}/sourceFilter.ts`,
      );
    }

    const sourceTransformerScript = unwrapGenerated(compileTransformerStepsToScript(ftData.sourceTransformerSteps), `${channel.name} source transformer`);
    if (sourceTransformerScript) {
      scripts['sourceTransformer'] = await this.compileWithTemplates(
        sourceTransformerScript, 'sourceTransformer', templates, `${channel.name}/sourceTransformer.ts`,
      );
    }

    if (gs.preprocessor) {
      scripts['globalPreprocessor'] = await this.compileWithTemplates(
        gs.preprocessor, 'globalPreprocessor', templates, 'global/preprocessor.ts',
      );
    }
    if (gs.postprocessor) {
      scripts['globalPostprocessor'] = await this.compileWithTemplates(
        gs.postprocessor, 'globalPostprocessor', templates, 'global/postprocessor.ts',
      );
    }
    if (gs.deploy) {
      scripts['globalDeploy'] = await this.compileWithTemplates(
        gs.deploy, 'globalDeploy', templates, 'global/deploy.ts',
      );
    }
    if (gs.undeploy) {
      scripts['globalUndeploy'] = await this.compileWithTemplates(
        gs.undeploy, 'globalUndeploy', templates, 'global/undeploy.ts',
      );
    }

    const result: Record<string, CompiledScript> = {};
    for (const [key, value] of Object.entries(scripts)) {
      if (value) result[key] = value;
    }
    return result as ChannelScripts;
  }

  private async buildDestinationConfigs(
    channel: ChannelDetail,
    templates: ReadonlyArray<CodeTemplateData>,
    ftData: FilterTransformerData,
  ): Promise<DestinationConfig[]> {
    const configs: DestinationConfig[] = [];

    for (const d of channel.destinations) {
      const destScripts: Record<string, CompiledScript | undefined> = {};

      const destFilterRules = ftData.destinationFilterRules.get(d.id);
      if (destFilterRules) {
        const filterScript = unwrapGenerated(compileFilterRulesToScript(destFilterRules), `${channel.name}/${d.name} filter`);
        if (filterScript) {
          destScripts['filter'] = await this.compileWithTemplates(
            filterScript, 'destinationFilter', templates, `${channel.name}/${d.name}/filter.ts`,
          );
        }
      }

      const destTransformerSteps = ftData.destinationTransformerSteps.get(d.id);
      if (destTransformerSteps) {
        const txScript = unwrapGenerated(compileTransformerStepsToScript(destTransformerSteps), `${channel.name}/${d.name} transformer`);
        if (txScript) {
          destScripts['transformer'] = await this.compileWithTemplates(
            txScript, 'destinationTransformer', templates, `${channel.name}/${d.name}/transformer.ts`,
          );
        }
      }

      if (d.responseTransformer && d.responseTransformer.trim().length > 0) {
        destScripts['responseTransformer'] = await this.compileWithTemplates(
          d.responseTransformer, 'destinationResponseTransformer', templates, `${channel.name}/${d.name}/response-transformer.ts`,
        );
      }

      const cleanScripts: Record<string, CompiledScript> = {};
      for (const [key, value] of Object.entries(destScripts)) {
        if (value) cleanScripts[key] = value;
      }

      // Mirth's default ${DICOMMESSAGE} means the message itself, so it is no template.
      const template = destinationTemplate(d.connectorType, d.properties);
      configs.push({
        metaDataId: d.metaDataId,
        name: d.name,
        enabled: d.enabled,
        scripts: cleanScripts as DestinationScripts,
        queueMode: (d.queueMode ?? 'NEVER') as 'NEVER' | 'ON_FAILURE' | 'ALWAYS',
        waitForPrevious: d.waitForPrevious,
        ...(template === undefined ? {} : { template }),
      });
    }

    return configs;
  }

  private async wireJavaScriptSource(
    channel: ChannelDetail,
    source: SourceConnectorRuntime,
    templates: ReadonlyArray<CodeTemplateData>,
    maps: ChannelMaps,
  ): Promise<void> {
    if (channel.sourceConnectorType !== 'JAVASCRIPT') return;
    const jsReceiver = source as JavaScriptReceiver;
    const sourceScript = (channel.sourceConnectorProperties as { script: string }).script;
    const cachedScript = await this.compileWithTemplates(sourceScript, 'sourceReceiver', templates, `${channel.name}/js-source.js`);
    jsReceiver.setScriptRunner(async (_script) => {
      const execResult = await this.runChannelScript(cachedScript, channel, maps, { content: '' }, {});
      if (!execResult.ok) return execResult;
      return { ok: true as const, value: execResult.value.returnValue, error: null };
    });
  }

  private async wireJavaScriptDestinations(
    channel: ChannelDetail,
    destinations: Map<number, DestinationConnectorRuntime>,
    templates: ReadonlyArray<CodeTemplateData>,
    maps: ChannelMaps,
  ): Promise<void> {
    const dataTypeOptions = dataTypeOptionsFor(channel);
    for (const dest of channel.destinations) {
      if (dest.connectorType !== 'JAVASCRIPT') continue;
      const connector = destinations.get(dest.metaDataId);
      if (!connector) continue;
      const jsDispatcher = connector as JavaScriptDispatcher;
      const destScript = (dest.properties as { script: string }).script;
      const cachedScript = await this.compileWithTemplates(
        destScript, 'destinationDispatcher', templates, `${channel.name}/js-dest-${String(dest.metaDataId)}.js`,
      );
      const reads = await globalsNamed(cachedScript, VARIABLE_GLOBALS);
      if (!reads.ok) throw reads.error;
      jsDispatcher.setScriptRunner(async (_script, content, connectorMessage) => {
        // The script sees the message as every other stage does: parsed for its
        // data type, with what earlier stages put in the channel map.
        const execResult = await this.runChannelScript(cachedScript, channel, maps, {
          content,
          msg: parsedOrRaw(content, connectorMessage.dataType, dataTypeOptions),
          channelMap: connectorMessage.variables ?? {},
        }, { connectorMessage });
        if (!execResult.ok) return execResult;
        return { ok: true as const, value: execResult.value.returnValue, error: null };
      }, reads.value);
    }
  }

  /** A failed load is not cached, so the next deploy tries again. */
  private async sharedGlobalMap(channelId: string): Promise<GlobalMapProxy> {
    this.globalMap ??= loadGlobalMap();
    const pending = this.globalMap;
    try {
      return await pending;
    } catch (error) {
      if (this.globalMap === pending) this.globalMap = undefined;
      throw deployLoadError(channelId, 'the global map', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Changes the script makes to the global and global channel maps are kept,
   * key by key, as they are for pipeline scripts.
   */
  private async runChannelScript(
    script: CompiledScript,
    channel: ChannelDetail,
    maps: ChannelMaps,
    input: ChannelScriptInput,
    extras: Readonly<Record<string, unknown>>,
  ): Promise<Result<ExecutionResult>> {
    const gcmBefore = maps.gcm.toRecord();
    const globalBefore = maps.globalMap.toRecord();
    const msg = input.msg ?? input.content;
    const context = {
      msg, tmp: msg, rawData: input.content,
      sourceMap: {}, channelMap: { ...(input.channelMap ?? {}) }, connectorMap: {}, responseMap: {},
      globalChannelMap: gcmBefore, globalMap: globalBefore, configMap: maps.configMap,
      extras: { channelId: channel.id, channelName: channel.name, ...extras },
    };
    const result = await this.sandbox.execute(script, context, { timeout: channel.scriptTimeoutSeconds * 1_000, channelId: channel.id });
    if (result.ok) {
      maps.gcm.applyChanges(gcmBefore, result.value.mapUpdates.globalChannelMap);
      maps.globalMap.applyChanges(globalBefore, result.value.mapUpdates.globalMap);
    }
    return result;
  }

  private async runDeployScript(script: CompiledScript, channel: ChannelDetail, maps: ChannelMaps, name: string): Promise<void> {
    const result = await this.runChannelScript(script, channel, maps, { content: '' }, {});
    if (!result.ok) {
      throw new ServiceError('INVALID_INPUT', `Channel ${channel.name}: the ${name} script failed: ${result.error.message}`);
    }
  }

  /**
   * Throws the same error deploy would. Runs before a running channel is
   * stopped for a redeploy, so a script that does not compile cannot take a
   * working channel offline.
   */
  async checkScripts(bundle: DeploymentBundle): Promise<void> {
    const { channel } = bundle;
    const templates = templateData(bundle);
    const ftData = filterTransformerDataOf(channel);
    await this.compileChannelScripts(channel, templates, bundle.globalScripts, ftData);
    await this.buildDestinationConfigs(channel, templates, ftData);
    if (channel.sourceConnectorType === 'JAVASCRIPT') {
      const script = (channel.sourceConnectorProperties as { script: string }).script;
      await this.compileWithTemplates(script, 'sourceReceiver', templates, `${channel.name}/js-source.js`);
    }
    for (const dest of channel.destinations) {
      if (dest.connectorType !== 'JAVASCRIPT') continue;
      const script = (dest.properties as { script: string }).script;
      await this.compileWithTemplates(script, 'destinationDispatcher', templates, `${channel.name}/js-dest-${String(dest.metaDataId)}.js`);
    }
  }

  private async loadAlertsForChannel(channelId: string): Promise<readonly LoadedAlert[]> {
    const listResult = await AlertService.list({ page: 1, pageSize: 1000 });
    if (!listResult.ok) throw deployLoadError(channelId, 'alerts', listResult.error);

    const enabledAlerts = listResult.value.data.filter((a) => a.enabled);
    if (enabledAlerts.length === 0) return [];

    const ids = enabledAlerts.map((a) => a.id);
    const detailsResult = await AlertService.getByIds(ids);
    if (!detailsResult.ok) throw deployLoadError(channelId, 'alerts', detailsResult.error);

    return this.filterAlertsForChannel(detailsResult.value, channelId);
  }

  private filterAlertsForChannel(
    details: readonly import('./services/alert.service.js').AlertDetail[],
    channelId: string,
  ): readonly LoadedAlert[] {
    const loaded: LoadedAlert[] = [];
    for (const detail of details) {
      if (detail.channelIds.length > 0 && !detail.channelIds.includes(channelId)) continue;
      loaded.push({
        id: detail.id,
        name: detail.name,
        enabled: detail.enabled,
        trigger: detail.trigger,
        channelIds: detail.channelIds as readonly string[],
        actions: detail.actions.map((a) => ({
          id: a.id,
          actionType: a.actionType as 'EMAIL' | 'CHANNEL',
          recipients: a.recipients,
          properties: a.properties,
        })),
        subjectTemplate: detail.subjectTemplate,
        bodyTemplate: detail.bodyTemplate,
        reAlertIntervalMs: detail.reAlertIntervalMs,
        maxAlerts: detail.maxAlerts,
      });
    }
    return loaded;
  }

  async dispose(): Promise<void> {
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    this.silenceTimer = undefined;
    if (this.globalMap) {
      const proxy = await this.globalMap.catch(() => null);
      this.globalMap = undefined;
      if (proxy) await proxy.dispose();
    }
    this.sandbox.dispose();
  }
}

function logStoreFailure(failure: StoreFailure): void {
  logger.error(
    { channelId: failure.channelId, messageId: failure.messageId, metaDataId: failure.metaDataId, what: failure.what, errMsg: failure.errorMessage },
    'Message store write failed: part of a message could not be saved',
  );
}

interface FilterRuleRow {
  readonly enabled: boolean;
  readonly operator: string;
  readonly type: string;
  readonly script: string | null;
  readonly field: string | null;
  readonly condition: string | null;
  readonly values: ReadonlyArray<string> | null;
}

/** The four global scripts a deployment bundle carries (#225). */
interface GlobalScripts {
  readonly preprocessor: string;
  readonly postprocessor: string;
  readonly deploy: string;
  readonly undeploy: string;
}

function templateData(bundle: DeploymentBundle): ReadonlyArray<CodeTemplateData> {
  return bundle.templates.map((t) => ({ code: t.code, type: t.type, contexts: t.contexts }));
}

function deployLoadError(channelId: string, what: string, cause: Error): Error {
  return new Error(`Channel ${channelId} cannot deploy: failed to load ${what}: ${cause.message}`);
}

function unwrapGenerated(result: Result<string | null>, where: string): string | null {
  if (!result.ok) throw new ServiceError('INVALID_INPUT', `${where}: ${result.error.message}`);
  return result.value;
}

interface TransformerStepRow {
  readonly enabled: boolean;
  readonly type: string;
  readonly script: string | null;
}

interface FilterTransformerData {
  readonly sourceFilterRules: ReadonlyArray<FilterRuleRow>;
  readonly destinationFilterRules: ReadonlyMap<string, ReadonlyArray<FilterRuleRow>>;
  readonly sourceTransformerSteps: ReadonlyArray<TransformerStepRow>;
  readonly destinationTransformerSteps: ReadonlyMap<string, ReadonlyArray<TransformerStepRow>>;
}

/**
 * Read from the channel being deployed, not the database, so a recorded
 * deployment compiles the filters and transformers it was deployed with (#225).
 * A null connector is the source.
 */
export function filterTransformerDataOf(channel: ChannelDetail): FilterTransformerData {
  const sourceFilterRules: FilterRuleRow[] = [];
  const destinationFilterRules = new Map<string, FilterRuleRow[]>();
  const sourceTransformerSteps: TransformerStepRow[] = [];
  const destinationTransformerSteps = new Map<string, TransformerStepRow[]>();
  const bySequence = (a: { readonly sequenceNumber: number }, b: { readonly sequenceNumber: number }): number => a.sequenceNumber - b.sequenceNumber;

  for (const filter of channel.filters) {
    const rules = filter.connectorId === null ? sourceFilterRules : getOrAdd(destinationFilterRules, filter.connectorId);
    for (const r of [...filter.rules].sort(bySequence)) {
      rules.push({ enabled: r.enabled, operator: r.operator, type: r.type, script: r.script, field: r.field, condition: r.condition, values: r.values });
    }
  }
  for (const transformer of channel.transformers) {
    const steps = transformer.connectorId === null ? sourceTransformerSteps : getOrAdd(destinationTransformerSteps, transformer.connectorId);
    for (const s of [...transformer.steps].sort(bySequence)) {
      steps.push({ enabled: s.enabled, type: s.type, script: s.script });
    }
  }
  return { sourceFilterRules, destinationFilterRules, sourceTransformerSteps, destinationTransformerSteps };
}

function getOrAdd<T>(map: Map<string, T[]>, key: string): T[] {
  const existing = map.get(key);
  if (existing) return existing;
  const created: T[] = [];
  map.set(key, created);
  return created;
}

async function loadGlobalMap(): Promise<GlobalMapProxy> {
  const rows = await GlobalMapService.list();
  if (!rows.ok) throw rows.error;
  const proxy = new GlobalMapProxy({
    save: async (key, value, isJson) => {
      const result = await GlobalMapService.persist(key, value, isJson);
      if (!result.ok) throw result.error;
    },
    remove: async (key) => {
      const result = await GlobalMapService.persistRemoval(key);
      if (!result.ok) throw result.error;
    },
    onFlushError: (key, error) => {
      logger.error({ key, errMsg: error instanceof Error ? error.message : String(error) }, 'Failed to save a global map entry; it will be retried');
    },
  });
  proxy.load(rows.value);
  GlobalMapService.onChange((change) => {
    if (change.type === 'set') proxy.set(change.row);
    else if (change.type === 'delete') proxy.delete(change.key);
    else proxy.clear();
  });
  proxy.start();
  return proxy;
}

let engineInstance: EngineManager | null = null;

export function getEngine(): EngineManager {
  if (!engineInstance) {
    engineInstance = new EngineManager();
  }
  return engineInstance;
}

