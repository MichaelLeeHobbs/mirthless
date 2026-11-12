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
  GlobalChannelMap,
  GlobalMapProxy,
  QueueConsumer,
  compileScript,
  compileFilterRulesToScript,
  compileTransformerStepsToScript,
  prependTemplates,
  AlertManager,
  RecoveryManager,
  type RecoveryStore,
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
} from '@galvaniflow/engine';
import { AsyncLocalStorage } from 'node:async_hooks';
import { tryCatch, type Result } from 'stderr-lib';
import {
  createSourceConnector,
  createDestinationConnector,
  JavaScriptReceiver,
  JavaScriptDispatcher,
  DISPATCH_STATUS,
  type DispatchStatus,
  type SourceConnectorRuntime,
  type DestinationConnectorRuntime,
} from '@galvaniflow/connectors';
import { MESSAGE_STORAGE_MODE, CONTENT_TYPE, type MessageStorageMode, storeRecordSchema, findRecordsSchema, updateRecordSchema, collectionRecordIdSchema } from '@galvaniflow/core-models';
import { eq, asc } from 'drizzle-orm';
import { MessageService } from './services/message.service.js';
import { GlobalScriptService } from './services/global-script.service.js';
import { GlobalMapService } from './services/global-map.service.js';
import { ConfigMapService } from './services/config-map.service.js';
import { config } from './config/index.js';
import { CodeTemplateService } from './services/code-template.service.js';
import { CollectionService, type CollectionRecordResult } from './services/collection.service.js';
import { ResourceService } from './services/resource.service.js';
import { DataSourceService } from './services/data-source.service.js';
import { AlertService } from './services/alert.service.js';
import { EmailService } from './services/email.service.js';
import { resolveHttpSourceTls, resolveHttpDestinationTls } from './services/connector-tls-resolver.js';
import { db } from './lib/db.js';
import { ServiceError } from './lib/service-error.js';
import { safeHttpFetch } from './lib/safe-http-fetch.js';
import { channelFilters, filterRules, channelTransformers, transformerSteps } from './db/schema/index.js';
import { encryptContent, isContentEncryptionConfigured } from './lib/content-crypto.js';
import logger from './lib/logger.js';
import type { ChannelDetail } from './services/channel.service.js';

// ----- Types -----

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
  /**
   * Recover messages a prior crash left unprocessed. Runs once, on the first
   * start after deploy (call it after the runtime has started): destination
   * dispatchers only accept sends once started, so recovering at deploy time
   * marked every pending destination ERROR. Later calls are no-ops.
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
}

/** Response modes that answer the sender once the source has accepted the message. */
const RESPOND_BEFORE_DESTINATIONS: ReadonlySet<string> = new Set(['AUTO_BEFORE', 'AUTO_AFTER_TRANSFORMER']);

/**
 * Map the pipeline's outcome to what the source connector tells the sender.
 *
 * The channel's response mode decides whether a destination failure counts:
 * - AUTO_BEFORE / AUTO_AFTER_TRANSFORMER: no. The message was accepted and
 *   recorded, so the sender gets a success and does not resend (a resend would
 *   deliver a second copy to the destinations that worked).
 * - every other mode (AUTO_AFTER_DESTINATIONS is the default): yes.
 * An error before routing is always reported: nothing was delivered.
 */
export function toDispatchStatus(
  outcome: { readonly status: 'SENT' | 'FILTERED' | 'ERROR'; readonly errorStage?: 'SOURCE' | 'DESTINATION' | undefined },
  responseMode: string,
): DispatchStatus {
  if (outcome.status === 'FILTERED') return DISPATCH_STATUS.FILTERED;
  if (outcome.status !== 'ERROR') return DISPATCH_STATUS.PROCESSED;
  if (outcome.errorStage === 'DESTINATION' && RESPOND_BEFORE_DESTINATIONS.has(responseMode)) {
    return DISPATCH_STATUS.PROCESSED;
  }
  return DISPATCH_STATUS.ERROR;
}

/** Where a channel's response to the sender comes from, by its response mode. */
export function toResponseSource(responseMode: string, responseConnectorName: string | null): ResponseSource | undefined {
  if (responseMode === 'POSTPROCESSOR') return { kind: 'POSTPROCESSOR' };
  if (responseMode === 'DESTINATION' && responseConnectorName) {
    return { kind: 'DESTINATION', destinationName: responseConnectorName };
  }
  return undefined;
}

// ----- Storage Policy -----

/** Per-channel storage configuration captured from channel settings. */
export interface StorageConfig {
  readonly messageStorageMode: MessageStorageMode;
  readonly removeContentOnCompletion: boolean;
  readonly removeAttachmentsOnCompletion: boolean;
  /** When true, encrypt content at rest (AES-256-GCM) before persisting. */
  readonly encryptData: boolean;
}

const OK_VOID = { ok: true as const, value: undefined, error: null } as Result<void>;

/** Build a failure Result carrying the given error. */
function fail<T>(error: Result<T>['error'] & object): Result<T> {
  return { ok: false, value: null, error } as Result<T>;
}

/** Error content types (always stored except in METADATA/DISABLED). */
const ERROR_CONTENT_TYPES: ReadonlySet<number> = new Set([
  CONTENT_TYPE.ERROR, CONTENT_TYPE.RESPONSE_ERROR, CONTENT_TYPE.PROCESSING_ERROR,
]);

/**
 * PRODUCTION stores everything needed to deliver, view, recover, and reprocess a
 * message — RAW (reprocess), SENT (queued delivery + crash recovery), the
 * transformed/encoded/response bodies (message browser), and all errors. It omits
 * only the debug-only PROCESSED copy and the map snapshots (Mirth's "Production"
 * semantics). RAW must be present or crash recovery and reprocess break; SENT must
 * be present or queued destinations reload null content and error 100% of messages.
 */
const PRODUCTION_CONTENT_TYPES: ReadonlySet<number> = new Set([
  CONTENT_TYPE.RAW, CONTENT_TYPE.TRANSFORMED, CONTENT_TYPE.ENCODED,
  CONTENT_TYPE.SENT, CONTENT_TYPE.RESPONSE, CONTENT_TYPE.RESPONSE_TRANSFORMED,
  CONTENT_TYPE.RESPONSE_SENT,
  ...ERROR_CONTENT_TYPES,
]);

/** RAW mode keeps only the raw inbound content (enough to reprocess) plus errors. */
const RAW_CONTENT_TYPES: ReadonlySet<number> = new Set([
  CONTENT_TYPE.RAW, ...ERROR_CONTENT_TYPES,
]);

/**
 * Determines whether a given content type should be stored based on the storage mode.
 * Error content types are stored in every mode except METADATA/DISABLED.
 */
export function shouldStoreContent(mode: MessageStorageMode, contentType: number): boolean {
  if (mode === MESSAGE_STORAGE_MODE.DEVELOPMENT) return true;
  if (mode === MESSAGE_STORAGE_MODE.PRODUCTION) return PRODUCTION_CONTENT_TYPES.has(contentType);
  if (mode === MESSAGE_STORAGE_MODE.RAW) return RAW_CONTENT_TYPES.has(contentType);
  // METADATA, DISABLED: no content stored
  return false;
}

/**
 * A storage mode stores enough content to deliver a queued message and recover it
 * after a crash (needs RAW + SENT). METADATA/DISABLED store neither, so a queued
 * destination on such a channel would lose 100% of messages. Used to reject the
 * combination at deploy time.
 */
export function storageModeSupportsQueue(mode: MessageStorageMode): boolean {
  return shouldStoreContent(mode, CONTENT_TYPE.SENT) && shouldStoreContent(mode, CONTENT_TYPE.RAW);
}

// ----- Message Store Adapter -----

/**
 * Adapts MessageService (static methods) to the MessageStore interface.
 * When a StorageConfig is provided, filters storeContent calls by storage mode
 * and handles content/attachment cleanup on completion.
 */
export function createMessageStoreAdapter(config?: StorageConfig): MessageStore {
  const mode = config?.messageStorageMode ?? MESSAGE_STORAGE_MODE.DEVELOPMENT;
  const encrypt = config?.encryptData ?? false;
  const removesOnCompletion = Boolean(config?.removeContentOnCompletion) || Boolean(config?.removeAttachmentsOnCompletion);
  /** Apply the channel's remove-on-completion settings to one finished message. */
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
    // markProcessed is used on both success and error/recovery paths, so it must
    // NOT delete content (error content is needed for investigation, and a message
    // with a still-queued destination must keep its content to deliver). Content
    // removal happens via removeCompletedContent, called by the pipeline only on
    // full successful completion.
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
    storeCustomMetadata: (channelId, messageId, metaDataId, metadata) =>
      MessageService.storeCustomMetadata(channelId, messageId, metaDataId, metadata),
    initializeMessage: (channelId, serverId, connectorName, contentRows, correlationId) => {
      // Filter content rows by storage policy before sending to batch
      const filtered = contentRows.filter((r) => shouldStoreContent(mode, r.contentType));
      if (!encrypt) {
        return MessageService.initializeMessage(channelId, serverId, connectorName, filtered, correlationId, false);
      }
      // Encrypt each surviving content row before it is persisted. Fail loud on
      // any encryption error so the whole message init fails rather than storing
      // PHI in plaintext under an encryptData channel.
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

// ----- Sandbox bridges -----

/** Shape a service record for the sandbox bridge (dates as ISO strings). */
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

/**
 * getCollection() script bridge: store/find/update/delete against CollectionService. Inputs
 * from user scripts are Zod-validated at this boundary (fail loud on bad input);
 * service errors surface as thrown errors inside the script.
 */
function createCollectionBridge(): NonNullable<BridgeDependencies['collections']> {
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

/** getResource() script bridge: read a resource's content by name (null if absent). */
function createResourceBridge(): NonNullable<BridgeDependencies['getResource']> {
  return async (name) => {
    const result = await ResourceService.getByName(name);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
}

/** dbQuery() script bridge: parameterized query against a named Data Source (read-only by default). */
function createDbQueryBridge(): NonNullable<BridgeDependencies['dbQuery']> {
  return async (dataSourceName, sql, params) => {
    const result = await DataSourceService.runQuery(dataSourceName, sql, params);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
}

/**
 * httpFetch() script bridge. The transport (safeHttpFetch) re-checks every
 * resolved address, never follows redirects and caps the response size, so a
 * DNS name or redirect cannot reach a blocked address the hostname check missed.
 */
export function createHttpFetchBridge(): NonNullable<BridgeDependencies['httpFetch']> {
  return (url, options) => safeHttpFetch(url, options, config.SCRIPT_HTTP_ALLOWED_HOSTS);
}

// ----- Engine Manager -----

/** Max routeMessage hops in a single message's processing chain (loop guard). */
const MAX_ROUTE_DEPTH = 25;

/** routeMessage hop depth of the message chain currently executing. */
const routeDepthStore = new AsyncLocalStorage<number>();

/** How often deployed channels are checked for NO_MESSAGES alerts. */
const SILENCE_CHECK_INTERVAL_MS = 30_000;
/** Longest a destination send may take when the connector sets no shorter timeout of its own. */
const SEND_BACKSTOP_MS = 300_000;
const NEVER_RAN_MESSAGE = 'Not delivered: the server stopped before this destination ran. Reprocess the message to deliver it.';

export class EngineManager {
  private readonly runtimes = new Map<string, DeployedChannel>();
  private readonly sandbox: SandboxExecutor;
  private readonly serverId: string;
  /** Periodic NO_MESSAGES alert check; started on first deploy, cleared on dispose. */
  private silenceTimer: ReturnType<typeof setInterval> | undefined;
  /** The one global map every channel shares; loaded on first deploy, flushed on dispose. */
  private globalMap: Promise<GlobalMapProxy> | undefined;
  /** Channels with a deploy in progress. */
  private readonly deploying = new Set<string>();

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

  /** Resolve a deployed channel's id by its name (in-memory; deployed channels only). */
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

  /** routeMessage() script bridge: cross-channel routing with a loop guard. */
  private createRouteMessageBridge(): NonNullable<BridgeDependencies['routeMessage']> {
    return async (channelName, rawData) => {
      const result = await this.routeMessage(channelName, rawData);
      if (!result.ok) throw new Error(result.error.message);
      const { messageId, status, response } = result.value;
      const filtered = status === DISPATCH_STATUS.FILTERED;
      return response === undefined ? { success: true, messageId, filtered } : { success: true, messageId, filtered, response };
    };
  }

  /** Deploy a channel from its stored configuration. */
  async deploy(channel: ChannelDetail): Promise<void> {
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
      await this.deployChannel(channel);
    } finally {
      this.deploying.delete(channel.id);
    }
  }

  private async deployChannel(channel: ChannelDetail): Promise<void> {

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
    // to deliver and to recover after a crash. On METADATA/DISABLED storage that
    // content is never written, so every queued message would error on delivery.
    const storageMode = channel.messageStorageMode as MessageStorageMode;
    const hasQueuedDestination = channel.destinations.some((d) => d.queueMode !== 'NEVER');
    if (hasQueuedDestination && !storageModeSupportsQueue(storageMode)) {
      throw new Error(
        `Channel ${channel.id} has a queued destination but message storage mode is ${storageMode}, ` +
        'which does not persist the RAW/SENT content required to deliver and recover queued messages. ' +
        'Use DEVELOPMENT, PRODUCTION, or RAW storage, or set every destination queue mode to NEVER.',
      );
    }

    const runtime = new ChannelRuntime();
    const gcm = new GlobalChannelMap();

    // Create per-channel message store adapter with storage policy
    const store = createMessageStoreAdapter({
      messageStorageMode: storageMode,
      removeContentOnCompletion: channel.removeContentOnCompletion,
      removeAttachmentsOnCompletion: channel.removeAttachmentsOnCompletion,
      encryptData: channel.encryptData,
    });

    // Create source connector. For HTTP, resolve any HTTPS cert-ID references to
    // PEM material server-side (connectors have no DB access). Fail loud so a
    // channel never deploys silently without the TLS it was configured for.
    let sourceProperties: Record<string, unknown> = channel.sourceConnectorProperties;
    if (channel.sourceConnectorType === 'HTTP') {
      const resolved = await resolveHttpSourceTls(sourceProperties);
      if (!resolved.ok) {
        throw new Error(`Channel ${channel.id} source TLS resolution failed: ${resolved.error.message}`);
      }
      sourceProperties = resolved.value;
    }
    const source = createSourceConnector(
      channel.sourceConnectorType,
      sourceProperties,
    ) as SourceConnectorRuntime;

    // Create destination connectors (HTTP destinations resolve HTTPS cert-IDs too).
    const destinations = new Map<number, DestinationConnectorRuntime>();
    for (const dest of channel.destinations) {
      let destProperties: Record<string, unknown> = dest.properties;
      if (dest.connectorType === 'HTTP') {
        const resolved = await resolveHttpDestinationTls(destProperties);
        if (!resolved.ok) {
          throw new Error(`Channel ${channel.id} destination ${dest.metaDataId} TLS resolution failed: ${resolved.error.message}`);
        }
        destProperties = resolved.value;
      }
      const connector = createDestinationConnector(
        dest.connectorType,
        destProperties,
      );
      destinations.set(dest.metaDataId, connector);
    }

    // Load code templates, global scripts, alerts, filter/transformer data, configMap, and globalMap in parallel
    const [templatesResult, globalScriptsResult, filterTransformerData, loadedAlerts, configMapResult, globalMapProxyInstance] = await Promise.all([
      CodeTemplateService.listTemplates(),
      GlobalScriptService.getAll(),
      this.loadFilterTransformerData(channel.id),
      this.loadAlertsForChannel(channel.id),
      ConfigMapService.list(),
      this.sharedGlobalMap(channel.id),
    ]);

    // Fail loud, never silent: a channel deployed without its code templates,
    // global scripts, config map or global map would run with different behaviour
    // from the one it was configured with.
    if (!templatesResult.ok) throw deployLoadError(channel.id, 'code templates', templatesResult.error);
    if (!globalScriptsResult.ok) throw deployLoadError(channel.id, 'global scripts', globalScriptsResult.error);
    if (!configMapResult.ok) throw deployLoadError(channel.id, 'the configuration map', configMapResult.error);

    const templates: ReadonlyArray<CodeTemplateData> = templatesResult.value
      .map((t) => ({ code: t.code, type: t.type, contexts: t.contexts }));

    // Compile all channel scripts (source + destinations + global)
    const scripts = await this.compileChannelScripts(
      channel, templates, globalScriptsResult.value, filterTransformerData,
    );

    // Build destination configs with compiled scripts
    const destConfigs: DestinationConfig[] = await this.buildDestinationConfigs(
      channel, templates, filterTransformerData,
    );

    // Create email sender callback for alert actions
    const emailSender = async (to: readonly string[], subject: string, body: string): Promise<void> => {
      const result = await EmailService.sendMail(to, subject, body);
      if (!result.ok) {
        logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to send alert email');
      }
    };

    // Create alert manager and load alerts for this channel
    // CHANNEL alert action: hand the alert text to another deployed channel.
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
    const raiseAlert = (event: Parameters<AlertManager['handleEvent']>[0]): Promise<void> => {
      alertManager.handleEvent(event).catch((error: unknown) => {
        logger.error({ channelId: channel.id, errMsg: error instanceof Error ? error.message : String(error) }, 'Alert handling failed');
      });
      return Promise.resolve();
    };

    // Build configMap record (key format: "category.name")
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

    // Build pipeline config
    const pipelineConfig: PipelineConfig = {
      channelId: channel.id,
      serverId: this.serverId,
      dataType: channel.inboundDataType,
      scripts,
      destinations: destConfigs,
      globalChannelMap: gcm,
      globalMapProxy: globalMapProxyInstance,
      configMap: maps.configMap,
      scriptTimeoutMs: channel.scriptTimeoutSeconds * 1_000,
      responseSource: toResponseSource(channel.responseMode, channel.responseConnectorName),
      metadataColumns: channel.metadataColumns.flatMap((c) =>
        c.mappingExpression ? [{ name: c.name, dataType: c.dataType, mapping: c.mappingExpression }] : []),
      onError: raiseAlert,
      onStoreFailure: (failure) => {
        logger.error(
          { channelId: failure.channelId, messageId: failure.messageId, metaDataId: failure.metaDataId, what: failure.what, errMsg: failure.errorMessage },
          'Message store write failed: part of a message status could not be saved',
        );
      },
      onTiming: logger.level === 'debug' || logger.level === 'trace'
        ? (messageId, totalMs, stages) => {
            logger.debug(
              { channelId: channel.id, channelName: channel.name, messageId, totalMs, stages },
              'Pipeline timing',
            );
          }
        : undefined,
    };

    // Build send function
    const sendFn: SendToDestination = async (metaDataId, messageId, content, signal, correlationId) => {
      const connector = destinations.get(metaDataId);
      if (!connector) {
        return tryCatch(() => { throw new Error(`Destination ${String(metaDataId)} not found`); });
      }
      // Connectors apply their own configured timeouts; this is the backstop
      // that keeps a send from hanging forever if one does not.
      return connector.send({
        channelId: channel.id, messageId, metaDataId, content,
        dataType: channel.inboundDataType, correlationId,
      }, AbortSignal.any([signal, AbortSignal.timeout(SEND_BACKSTOP_MS)]));
    };

    // Create queue consumers for queued destinations
    const queueConsumers: QueueConsumer[] = [];
    for (const dest of channel.destinations) {
      if (dest.queueMode === 'NEVER') continue;
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
      };
      queueConsumers.push(new QueueConsumer(queueConfig, store, sendFn));
    }

    // Create message processor
    const processor = new MessageProcessor(
      this.sandbox, store, sendFn, pipelineConfig, DEFAULT_EXECUTION_OPTIONS,
    );

    // Build the processMessage callback (used by both source connector and sendMessage API)
    const activity = { lastAt: Date.now() };
    const processMessage = async (rawContent: string, sourceMap?: Record<string, unknown>): Promise<Result<SourceDispatchOutcome>> => {
      activity.lastAt = Date.now();
      // Extract correlationId from sourceMap if present (channel-to-channel routing)
      const correlationId = typeof sourceMap?.['correlationId'] === 'string'
        ? sourceMap['correlationId'] as string
        : undefined;
      const result = await processor.processMessage(
        { rawContent, sourceMap: sourceMap ?? {}, correlationId },
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
      const { messageId, response } = result.value;
      const status = toDispatchStatus(result.value, channel.responseMode);
      return { ok: true, value: response === undefined ? { messageId, status } : { messageId, status, response }, error: null };
    };

    // Build runtime config
    const runtimeConfig: ChannelRuntimeConfig = {
      channelId: channel.id,
      source,
      destinations,
      onMessage: async (raw) => processMessage(raw.content, raw.sourceMap),
    };

    // Taken before the channel can receive anything: every unprocessed message
    // up to this id was left by an earlier run.
    const recoveryHorizon = await MessageService.getLatestMessageId(channel.id);

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
      for (const dest of channel.destinations) {
        if (dest.queueMode === 'NEVER') continue;
        const reset = await MessageService.resetPending(channel.id, dest.metaDataId);
        if (!reset.ok) {
          logger.error({ channelId: channel.id, metaDataId: dest.metaDataId, errMsg: reset.error.message }, 'Failed to reset PENDING messages');
        }
      }
    };

    let recovered = false;
    const recoverOnce = async (): Promise<void> => {
      if (recovered) return;
      recovered = true;
      await this.recoverChannel(channel, store, processMessage, sendFn, recoveryHorizon);
    };

    this.runtimes.set(channel.id, { channelId: channel.id, runtime, config: channel, globalChannelMap: gcm, globalMapProxy: globalMapProxyInstance, configMap: maps.configMap, alertManager, queueConsumers, scripts, processMessage, recoverOnce, resetClaimsOnce, activity });
    this.silenceTimer ??= setInterval(() => { void this.checkSilentChannels(); }, SILENCE_CHECK_INTERVAL_MS).unref();
  }

  /**
   * Fire NO_MESSAGES alerts for started channels that have gone quiet. A channel
   * that is not STARTED restarts its silence clock, so stopping it never alerts
   * and a restart gets a full window before the first alert.
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

  /** Get a deployed channel runtime. */
  getRuntime(channelId: string): DeployedChannel | undefined {
    return this.runtimes.get(channelId);
  }

  /** Get all deployed channel runtimes. */
  getAll(): ReadonlyMap<string, DeployedChannel> {
    return this.runtimes;
  }

  /** Send a raw message to a deployed, started channel. */
  async sendMessage(channelId: string, content: string): Promise<Result<SourceDispatchOutcome>> {
    return tryCatch(async () => {
      const deployed = this.runtimes.get(channelId);
      if (!deployed) {
        throw new Error(`Channel ${channelId} is not deployed`);
      }
      const state = deployed.runtime.getState();
      if (state !== 'STARTED') {
        throw new Error(`Channel is ${state}, must be STARTED to receive messages`);
      }
      const result = await deployed.processMessage(content);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.value;
    });
  }

  /** Undeploy a channel and remove it from management. */
  async undeploy(channelId: string): Promise<void> {
    const deployed = this.runtimes.get(channelId);
    if (!deployed) {
      throw new Error(`Channel ${channelId} is not deployed`);
    }

    // Stop queue consumers before the connectors: stop() waits for the send in
    // flight, so no queued delivery fails (and burns a retry) because its
    // destination was stopped underneath it.
    await Promise.all(deployed.queueConsumers.map((c) => c.stop()));

    // Stop the running channel first — runtime.undeploy() requires STOPPED, and
    // shutdown/undeploy must never throw on a STARTED channel (that would sever
    // in-flight messages and skip the rest of the teardown). Stopping first
    // drains the source connector cleanly. Idempotent for already-STOPPED channels.
    const state = deployed.runtime.getState();
    if (state === 'STARTED' || state === 'PAUSED') {
      const stopResult = await deployed.runtime.stop();
      if (!stopResult.ok) {
        // Fall back to a force-halt so teardown can still proceed.
        await deployed.runtime.halt();
      }
    }

    // Execute channel undeploy script (before cleanup)
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
   * - RECEIVED source messages are reprocessed from their stored raw content.
   * - RECEIVED destination messages are re-dispatched from their stored SENT content.
   * QUEUED messages are left for the queue consumers. All failures are logged only.
   */
  private async recoverChannel(
    channel: ChannelDetail,
    store: MessageStore,
    processMessage: (rawContent: string, sourceMap?: Record<string, unknown>) => Promise<Result<{ messageId: number }>>,
    sendFn: SendToDestination,
    horizon: Result<number>,
  ): Promise<void> {
    // Without the horizon there is no telling a leftover message from one the
    // running channel is working on right now, and recovering the latter would
    // process it twice. Skip, and say so.
    if (!horizon.ok) {
      logger.error({ channelId: channel.id, errMsg: horizon.error.message }, 'Channel recovery skipped: could not read the newest message id at deploy');
      return;
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

    const CT_RAW = 1;
    const CT_SENT = 5;
    const CT_SOURCE_MAP = 9;

    // The original sourceMap (e.g. correlationId from an upstream channel) is
    // stored with the message; carry it into the reprocess. It may be absent
    // under storage modes that do not keep it, in which case it starts empty.
    const loadSourceMap = async (channelId: string, messageId: number): Promise<Record<string, unknown>> => {
      const stored = await store.loadContent(channelId, messageId, 0, CT_SOURCE_MAP);
      if (!stored.ok || stored.value === null) return {};
      try {
        const parsed: unknown = JSON.parse(stored.value);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      } catch {
        return {};
      }
    };

    const reprocessSource = async (channelId: string, messageId: number): Promise<Result<void>> => {
      const raw = await store.loadContent(channelId, messageId, 0, CT_RAW);
      if (!raw.ok || raw.value === null) {
        return { ok: false, value: null, error: new Error('Raw content unavailable for recovery') } as Result<void>;
      }
      const processed = await processMessage(raw.value, await loadSourceMap(channelId, messageId));
      if (!processed.ok) {
        // Do NOT mark processed on failure — the original still holds recoverable
        // raw content and must remain eligible for recovery on the next deploy.
        // Marking it here would silently lose the message forever.
        return { ok: false, value: null, error: processed.error } as Result<void>;
      }
      // Run again as a new message. Close the original so it is not recovered a
      // second time and does not sit in the browser looking like a message that
      // is still being received: mark it ERROR with a note naming the new one.
      // Both rows stay in the browser and both were counted as received when
      // they were created. The original adds no error to the statistics: only
      // the outcome of the new message is counted.
      const note = `Interrupted by a server stop before it finished. Run again as message ${String(processed.value.messageId)}.`;
      const closed = await Promise.all([
        store.storeContent(channelId, messageId, 0, CONTENT_TYPE.PROCESSING_ERROR, note, 'TEXT'),
        store.updateConnectorMessageStatus(channelId, messageId, 0, 'ERROR'),
        MessageService.markProcessed(channelId, messageId),
      ]);
      const failed = closed.find((r) => !r.ok);
      if (failed && !failed.ok) {
        logger.error({ channelId, messageId, errMsg: failed.error.message }, 'Recovered message could not be closed; it may be run again on the next deploy');
        return { ok: false, value: null, error: failed.error } as Result<void>;
      }
      return OK_VOID;
    };

    const redispatchDestination = async (channelId: string, messageId: number, metaDataId: number): Promise<Result<void>> => {
      const sent = await store.loadContent(channelId, messageId, metaDataId, CT_SENT);
      if (!sent.ok) {
        return { ok: false, value: null, error: sent.error } as Result<void>;
      }
      if (sent.value === null) {
        // The server stopped before this destination's filter and transformer
        // ran, so there is nothing ready to send. Running them now would need
        // the maps of a message that no longer exists in memory; record the
        // destination as failed so it shows up and can be reprocessed.
        logger.error({ channelId, messageId, metaDataId }, 'Destination never ran before the server stopped; marked ERROR, reprocess the message to deliver it');
        await Promise.all([
          store.storeContent(channelId, messageId, metaDataId, CONTENT_TYPE.PROCESSING_ERROR, NEVER_RAN_MESSAGE, 'TEXT'),
          store.updateConnectorMessageStatus(channelId, messageId, metaDataId, 'ERROR'),
          store.updateConnectorMessageStatus(channelId, messageId, 0, 'ERROR'),
          store.incrementStats(channelId, metaDataId, this.serverId, 'errored'),
        ]);
        return OK_VOID;
      }
      const sendResult = await sendFn(metaDataId, messageId, sent.value, AbortSignal.timeout(30_000));
      const success = sendResult.ok && sendResult.value.status === 'SENT';
      await store.updateConnectorMessageStatus(channelId, messageId, metaDataId, success ? 'SENT' : 'ERROR');
      await store.incrementStats(channelId, metaDataId, this.serverId, success ? 'sent' : 'errored');
      return success ? OK_VOID : ({ ok: false, value: null, error: new Error('Redispatch send failed') } as Result<void>);
    };

    const manager = new RecoveryManager(recoveryStore, reprocessSource, redispatchDestination);
    const recovered = await manager.recover(channel.id);
    if (!recovered.ok) {
      logger.error({ channelId: channel.id, errMsg: recovered.error.message }, 'Channel recovery failed');
      return;
    }
    const summary = recovered.value;
    if (summary.recovered > 0 || summary.errors > 0) {
      logger.info({ channelId: channel.id, ...summary }, 'Channel recovery complete');
    }
  }

  /** Compile a script with optional template prepending. */
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

  /** Compile channel scripts from stored configuration + DB filter/transformer data + global scripts. */
  private async compileChannelScripts(
    channel: ChannelDetail,
    templates: ReadonlyArray<CodeTemplateData>,
    gs: GlobalScripts,
    ftData: FilterTransformerData,
  ): Promise<ChannelScripts> {
    const scripts: Record<string, CompiledScript | undefined> = {};

    // Channel preprocessor/postprocessor/deploy/undeploy from channel_scripts table
    for (const script of channel.scripts) {
      if (!script.script) continue;
      const key = script.scriptType.toLowerCase();
      if (key === 'preprocessor' || key === 'postprocessor' || key === 'deploy' || key === 'undeploy') {
        scripts[key] = await this.compileWithTemplates(
          script.script, key, templates, `${channel.name}/${key}.ts`,
        );
      }
    }

    // Source filter from filter rules (connectorId IS NULL)
    const sourceFilterScript = unwrapGenerated(compileFilterRulesToScript(ftData.sourceFilterRules), `${channel.name} source filter`);
    if (sourceFilterScript) {
      scripts['sourceFilter'] = await this.compileWithTemplates(
        sourceFilterScript, 'sourceFilter', templates, `${channel.name}/sourceFilter.ts`,
      );
    }

    // Source transformer from transformer steps (connectorId IS NULL)
    const sourceTransformerScript = unwrapGenerated(compileTransformerStepsToScript(ftData.sourceTransformerSteps), `${channel.name} source transformer`);
    if (sourceTransformerScript) {
      scripts['sourceTransformer'] = await this.compileWithTemplates(
        sourceTransformerScript, 'sourceTransformer', templates, `${channel.name}/sourceTransformer.ts`,
      );
    }

    // Global preprocessor/postprocessor/deploy/undeploy
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

    // Remove undefined entries
    const result: Record<string, CompiledScript> = {};
    for (const [key, value] of Object.entries(scripts)) {
      if (value) result[key] = value;
    }
    return result as ChannelScripts;
  }

  /** Build destination configs with compiled filter/transformer scripts. */
  private async buildDestinationConfigs(
    channel: ChannelDetail,
    templates: ReadonlyArray<CodeTemplateData>,
    ftData: FilterTransformerData,
  ): Promise<DestinationConfig[]> {
    const configs: DestinationConfig[] = [];

    for (const d of channel.destinations) {
      const destScripts: Record<string, CompiledScript | undefined> = {};

      // Destination filter
      const destFilterRules = ftData.destinationFilterRules.get(d.id);
      if (destFilterRules) {
        const filterScript = unwrapGenerated(compileFilterRulesToScript(destFilterRules), `${channel.name}/${d.name} filter`);
        if (filterScript) {
          destScripts['filter'] = await this.compileWithTemplates(
            filterScript, 'destinationFilter', templates, `${channel.name}/${d.name}/filter.ts`,
          );
        }
      }

      // Destination transformer
      const destTransformerSteps = ftData.destinationTransformerSteps.get(d.id);
      if (destTransformerSteps) {
        const txScript = unwrapGenerated(compileTransformerStepsToScript(destTransformerSteps), `${channel.name}/${d.name} transformer`);
        if (txScript) {
          destScripts['transformer'] = await this.compileWithTemplates(
            txScript, 'destinationTransformer', templates, `${channel.name}/${d.name}/transformer.ts`,
          );
        }
      }

      // Destination response transformer (runs on the send response)
      if (d.responseTransformer && d.responseTransformer.trim().length > 0) {
        destScripts['responseTransformer'] = await this.compileWithTemplates(
          d.responseTransformer, 'destinationResponseTransformer', templates, `${channel.name}/${d.name}/response-transformer.ts`,
        );
      }

      // Remove undefined entries
      const cleanScripts: Record<string, CompiledScript> = {};
      for (const [key, value] of Object.entries(destScripts)) {
        if (value) cleanScripts[key] = value;
      }

      configs.push({
        metaDataId: d.metaDataId,
        name: d.name,
        enabled: d.enabled,
        scripts: cleanScripts as DestinationScripts,
        queueMode: (d.queueMode ?? 'NEVER') as 'NEVER' | 'ON_FAILURE' | 'ALWAYS',
        waitForPrevious: d.waitForPrevious,
      });
    }

    return configs;
  }

  /** Wire JavaScript source connector ScriptRunner if applicable. Compiles script once at deploy time. */
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
      const execResult = await this.runChannelScript(cachedScript, channel, maps, '', {});
      if (!execResult.ok) return execResult;
      return { ok: true as const, value: execResult.value.returnValue, error: null };
    });
  }

  /** Wire JavaScript destination connector ScriptRunners if applicable. Compiles scripts once at deploy time. */
  private async wireJavaScriptDestinations(
    channel: ChannelDetail,
    destinations: Map<number, DestinationConnectorRuntime>,
    templates: ReadonlyArray<CodeTemplateData>,
    maps: ChannelMaps,
  ): Promise<void> {
    for (const dest of channel.destinations) {
      if (dest.connectorType !== 'JAVASCRIPT') continue;
      const connector = destinations.get(dest.metaDataId);
      if (!connector) continue;
      const jsDispatcher = connector as JavaScriptDispatcher;
      const destScript = (dest.properties as { script: string }).script;
      const cachedScript = await this.compileWithTemplates(
        destScript, 'destinationDispatcher', templates, `${channel.name}/js-dest-${String(dest.metaDataId)}.js`,
      );
      jsDispatcher.setScriptRunner(async (_script, content, connectorMessage) => {
        const execResult = await this.runChannelScript(cachedScript, channel, maps, content, { connectorMessage });
        if (!execResult.ok) return execResult;
        return { ok: true as const, value: execResult.value.returnValue, error: null };
      });
    }
  }

  /**
   * The global map shared by every channel. Loaded from the database once; a
   * failed load is not cached, so the next deploy tries again.
   */
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
   * Run one of a channel's own scripts (deploy, undeploy, JavaScript connector)
   * with the channel's maps. Changes the script makes to the global and global
   * channel maps are kept, key by key, as they are for pipeline scripts.
   */
  private async runChannelScript(
    script: CompiledScript,
    channel: ChannelDetail,
    maps: ChannelMaps,
    content: string,
    extras: Readonly<Record<string, unknown>>,
  ): Promise<Result<ExecutionResult>> {
    const gcmBefore = maps.gcm.toRecord();
    const globalBefore = maps.globalMap.toRecord();
    const context = {
      msg: content, tmp: content, rawData: content,
      sourceMap: {}, channelMap: {}, connectorMap: {}, responseMap: {},
      globalChannelMap: gcmBefore, globalMap: globalBefore, configMap: maps.configMap,
      extras: { channelId: channel.id, channelName: channel.name, ...extras },
    };
    const result = await this.sandbox.execute(script, context, { timeout: channel.scriptTimeoutSeconds * 1_000 });
    if (result.ok) {
      maps.gcm.applyChanges(gcmBefore, result.value.mapUpdates.globalChannelMap);
      maps.globalMap.applyChanges(globalBefore, result.value.mapUpdates.globalMap);
    }
    return result;
  }

  /** Run a deploy or undeploy script. Throws when the script fails. */
  private async runDeployScript(script: CompiledScript, channel: ChannelDetail, maps: ChannelMaps, name: string): Promise<void> {
    const result = await this.runChannelScript(script, channel, maps, '', {});
    if (!result.ok) {
      throw new ServiceError('INVALID_INPUT', `Channel ${channel.name}: the ${name} script failed: ${result.error.message}`);
    }
  }

  /**
   * Compile every script a channel would deploy with, without deploying it.
   * Throws the same error deploy would. Used before a running channel is
   * stopped for a redeploy, so a script that does not compile cannot take a
   * working channel offline.
   */
  async checkScripts(channel: ChannelDetail): Promise<void> {
    const [templatesResult, globalScriptsResult, ftData] = await Promise.all([
      CodeTemplateService.listTemplates(),
      GlobalScriptService.getAll(),
      this.loadFilterTransformerData(channel.id),
    ]);
    if (!templatesResult.ok) throw deployLoadError(channel.id, 'code templates', templatesResult.error);
    if (!globalScriptsResult.ok) throw deployLoadError(channel.id, 'global scripts', globalScriptsResult.error);
    const templates: ReadonlyArray<CodeTemplateData> = templatesResult.value
      .map((t) => ({ code: t.code, type: t.type, contexts: t.contexts }));
    await this.compileChannelScripts(channel, templates, globalScriptsResult.value, ftData);
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

  /** Load alerts applicable to a channel from the database. */
  private async loadAlertsForChannel(channelId: string): Promise<readonly LoadedAlert[]> {
    const listResult = await AlertService.list({ page: 1, pageSize: 1000 });
    if (!listResult.ok) throw deployLoadError(channelId, 'alerts', listResult.error);

    const enabledAlerts = listResult.value.data.filter((a) => a.enabled);
    if (enabledAlerts.length === 0) return [];

    // Batch fetch all enabled alert details in a single query
    const ids = enabledAlerts.map((a) => a.id);
    const detailsResult = await AlertService.getByIds(ids);
    if (!detailsResult.ok) throw deployLoadError(channelId, 'alerts', detailsResult.error);

    return this.filterAlertsForChannel(detailsResult.value, channelId);
  }

  /** Filter alert details to those applicable to a specific channel. */
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

  /** Load filter rules and transformer steps for a channel, grouped by connector. */
  private async loadFilterTransformerData(channelId: string): Promise<FilterTransformerData> {
    const [filterRows, transformerRows] = await Promise.all([
      db
        .select({
          filterId: channelFilters.id,
          connectorId: channelFilters.connectorId,
          ruleId: filterRules.id,
          sequenceNumber: filterRules.sequenceNumber,
          enabled: filterRules.enabled,
          operator: filterRules.operator,
          type: filterRules.type,
          script: filterRules.script,
          field: filterRules.field,
          condition: filterRules.condition,
          values: filterRules.values,
        })
        .from(channelFilters)
        .leftJoin(filterRules, eq(filterRules.filterId, channelFilters.id))
        .where(eq(channelFilters.channelId, channelId))
        .orderBy(asc(filterRules.sequenceNumber)),
      db
        .select({
          transformerId: channelTransformers.id,
          connectorId: channelTransformers.connectorId,
          stepId: transformerSteps.id,
          sequenceNumber: transformerSteps.sequenceNumber,
          enabled: transformerSteps.enabled,
          type: transformerSteps.type,
          script: transformerSteps.script,
        })
        .from(channelTransformers)
        .leftJoin(transformerSteps, eq(transformerSteps.transformerId, channelTransformers.id))
        .where(eq(channelTransformers.channelId, channelId))
        .orderBy(asc(transformerSteps.sequenceNumber)),
    ]);

    const sourceFilterRules: FilterRuleRow[] = [];
    const destinationFilterRules = new Map<string, FilterRuleRow[]>();
    const sourceTransformerSteps: TransformerStepRow[] = [];
    const destinationTransformerSteps = new Map<string, TransformerStepRow[]>();

    for (const row of filterRows) {
      if (!row.ruleId) continue; // LEFT JOIN produced no rules
      const rule: FilterRuleRow = {
        enabled: row.enabled ?? true,
        operator: row.operator ?? 'AND',
        type: row.type ?? 'JAVASCRIPT',
        script: row.script ?? null,
        field: row.field ?? null,
        condition: row.condition ?? null,
        values: row.values ?? null,
      };
      if (row.connectorId === null) {
        sourceFilterRules.push(rule);
      } else {
        const existing = destinationFilterRules.get(row.connectorId);
        if (existing) {
          existing.push(rule);
        } else {
          destinationFilterRules.set(row.connectorId, [rule]);
        }
      }
    }

    for (const row of transformerRows) {
      if (!row.stepId) continue; // LEFT JOIN produced no steps
      const step: TransformerStepRow = {
        enabled: row.enabled ?? true,
        type: row.type ?? 'JAVASCRIPT',
        script: row.script ?? null,
      };
      if (row.connectorId === null) {
        sourceTransformerSteps.push(step);
      } else {
        const existing = destinationTransformerSteps.get(row.connectorId);
        if (existing) {
          existing.push(step);
        } else {
          destinationTransformerSteps.set(row.connectorId, [step]);
        }
      }
    }

    return { sourceFilterRules, destinationFilterRules, sourceTransformerSteps, destinationTransformerSteps };
  }

  /** Dispose all resources. */
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

// ----- Internal Types -----

interface FilterRuleRow {
  readonly enabled: boolean;
  readonly operator: string;
  readonly type: string;
  readonly script: string | null;
  readonly field: string | null;
  readonly condition: string | null;
  readonly values: ReadonlyArray<string> | null;
}

/** The four global scripts, as GlobalScriptService returns them. */
interface GlobalScripts {
  readonly preprocessor: string;
  readonly postprocessor: string;
  readonly deploy: string;
  readonly undeploy: string;
}

/** Error for configuration a deploy depends on and could not load. */
function deployLoadError(channelId: string, what: string, cause: Error): Error {
  return new Error(`Channel ${channelId} cannot deploy: failed to load ${what}: ${cause.message}`);
}

/** Unwrap a generated filter/transformer script, refusing to deploy when a rule or step cannot run. */
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

/** Load the global map and keep it in step with edits made through the API. */
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

// ----- Singleton -----

let engineInstance: EngineManager | null = null;

/** Get or create the engine manager singleton. */
export function getEngine(): EngineManager {
  if (!engineInstance) {
    engineInstance = new EngineManager();
  }
  return engineInstance;
}

