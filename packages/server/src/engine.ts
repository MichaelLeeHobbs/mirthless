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
  type BridgeDependencies,
  type MessageStore,
  type SendToDestination,
  type CompiledScript,
  type CodeTemplateData,
  type QueueConsumerConfig,
  type LoadedAlert,
} from '@mirthless/engine';
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
} from '@mirthless/connectors';
import { MESSAGE_STORAGE_MODE, CONTENT_TYPE, type MessageStorageMode, storeRecordSchema, findRecordsSchema } from '@mirthless/core-models';
import { eq, asc } from 'drizzle-orm';
import { MessageService } from './services/message.service.js';
import { GlobalScriptService } from './services/global-script.service.js';
import { GlobalMapService } from './services/global-map.service.js';
import { ConfigMapService } from './services/config-map.service.js';
import { CodeTemplateService } from './services/code-template.service.js';
import { CollectionService, type CollectionRecordResult } from './services/collection.service.js';
import { ResourceService } from './services/resource.service.js';
import { AlertService } from './services/alert.service.js';
import { EmailService } from './services/email.service.js';
import { db } from './lib/db.js';
import { channelFilters, filterRules, channelTransformers, transformerSteps } from './db/schema/index.js';
import { encryptContent, isContentEncryptionConfigured } from './lib/content-crypto.js';
import logger from './lib/logger.js';
import type { ChannelDetail } from './services/channel.service.js';

// ----- Types -----

export interface DeployedChannel {
  readonly channelId: string;
  readonly runtime: ChannelRuntime;
  readonly config: ChannelDetail;
  readonly globalChannelMap: GlobalChannelMap;
  readonly globalMapProxy: GlobalMapProxy;
  readonly alertManager: AlertManager;
  readonly queueConsumers: readonly QueueConsumer[];
  readonly scripts: ChannelScripts;
  readonly processMessage: (rawContent: string, sourceMap?: Record<string, unknown>) => Promise<Result<SourceDispatchOutcome>>;
}

/**
 * What the source connector learns about a dispatched message. `status` lets a
 * source connector build the right response (e.g. an MLLP receiver returns an AA
 * ACK for SENT, AE for ERROR, AR for FILTERED).
 */
export interface SourceDispatchOutcome {
  readonly messageId: number;
  readonly status: DispatchStatus;
  readonly response?: string;
}

/** Map the pipeline's message status to the source-connector dispatch status. */
function toDispatchStatus(status: 'SENT' | 'FILTERED' | 'ERROR'): DispatchStatus {
  if (status === 'FILTERED') return DISPATCH_STATUS.FILTERED;
  if (status === 'ERROR') return DISPATCH_STATUS.ERROR;
  return DISPATCH_STATUS.PROCESSED;
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
    removeCompletedContent: async (channelId, messageId) => {
      if (!config?.removeContentOnCompletion && !config?.removeAttachmentsOnCompletion) {
        return OK_VOID;
      }
      const deletes: Promise<Result<void>>[] = [];
      if (config?.removeContentOnCompletion) {
        deletes.push(MessageService.deleteContent(channelId, messageId));
      }
      if (config?.removeAttachmentsOnCompletion) {
        deletes.push(MessageService.deleteAttachments(channelId, messageId));
      }
      const results = await Promise.all(deletes);
      const failed = results.find((r) => !r.ok);
      return failed ?? OK_VOID;
    },
    enqueue: (channelId, messageId, metaDataId) =>
      MessageService.enqueue(channelId, messageId, metaDataId),
    loadContent: (channelId, messageId, metaDataId, contentType) =>
      MessageService.loadContent(channelId, messageId, metaDataId, contentType as Parameters<typeof MessageService.loadContent>[3]),
    incrementStats: (channelId, metaDataId, serverId, field) =>
      MessageService.incrementStats(channelId, metaDataId, serverId, field),
    dequeue: (channelId, metaDataId, batchSize) =>
      MessageService.dequeue(channelId, metaDataId, batchSize),
    release: (channelId, messageId, metaDataId, newStatus) =>
      MessageService.release(channelId, messageId, metaDataId, newStatus as Parameters<typeof MessageService.release>[3]),
    storeAttachment: (channelId, messageId, attachmentId, mimeType, content, size) =>
      MessageService.storeAttachment(channelId, messageId, attachmentId, mimeType, content, size),
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
 * getCollection() script bridge: store/find against CollectionService. Inputs
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

/**
 * httpFetch() script bridge: outbound HTTP via global fetch. SSRF host-blocking is
 * already applied in the sandbox bridge layer before this runs; here we just perform
 * the request, enforce a per-request timeout, and shape the response.
 */
export function createHttpFetchBridge(): NonNullable<BridgeDependencies['httpFetch']> {
  return async (url, options) => {
    const res = await fetch(url, {
      method: options.method ?? 'GET',
      ...(options.headers ? { headers: { ...options.headers } } : {}),
      ...(options.body !== undefined ? { body: options.body } : {}),
      signal: AbortSignal.timeout(options.timeout ?? 30_000),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => { headers[key] = value; });
    return { status: res.status, statusText: res.statusText, headers, body: await res.text() };
  };
}

// ----- Engine Manager -----

/** Max routeMessage hops in a single message's processing chain (loop guard). */
const MAX_ROUTE_DEPTH = 25;

export class EngineManager {
  private readonly runtimes = new Map<string, DeployedChannel>();
  private readonly sandbox: SandboxExecutor;
  private readonly serverId: string;
  /** Current routeMessage nesting depth (one process chain); guards against routing loops. */
  private routeDepth = 0;

  constructor(serverId?: string) {
    this.sandbox = new VmSandboxExecutor({
      collections: createCollectionBridge(),
      getResource: createResourceBridge(),
      httpFetch: createHttpFetchBridge(),
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
  async routeMessage(channelName: string, rawData: string): Promise<Result<{ messageId: number }>> {
    return tryCatch(async () => {
      if (this.routeDepth >= MAX_ROUTE_DEPTH) {
        throw new Error(`routeMessage exceeded max hop depth (${String(MAX_ROUTE_DEPTH)}) — possible routing loop`);
      }
      const targetId = this.resolveChannelIdByName(channelName);
      if (!targetId) {
        throw new Error(`routeMessage: no deployed channel named "${channelName}"`);
      }
      this.routeDepth++;
      try {
        const result = await this.sendMessage(targetId, rawData);
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      } finally {
        this.routeDepth--;
      }
    });
  }

  /** routeMessage() script bridge: cross-channel routing with a loop guard. */
  private createRouteMessageBridge(): NonNullable<BridgeDependencies['routeMessage']> {
    return async (channelName, rawData) => {
      const result = await this.routeMessage(channelName, rawData);
      if (!result.ok) throw new Error(result.error.message);
      return { success: true };
    };
  }

  /** Deploy a channel from its stored configuration. */
  async deploy(channel: ChannelDetail): Promise<void> {
    if (this.runtimes.has(channel.id)) {
      throw new Error(`Channel ${channel.id} is already deployed`);
    }

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

    // Wire JavaScript source script runner (compile once at deploy)
    await this.wireJavaScriptSource(channel, source);

    // Wire JavaScript destination script runners (compile once at deploy)
    await this.wireJavaScriptDestinations(channel, destinations);

    // Load code templates, global scripts, alerts, filter/transformer data, configMap, and globalMap in parallel
    const [templatesResult, globalScriptsResult, filterTransformerData, loadedAlerts, configMapResult, globalMapResult] = await Promise.all([
      CodeTemplateService.listTemplates(),
      GlobalScriptService.getAll(),
      this.loadFilterTransformerData(channel.id),
      this.loadAlertsForChannel(channel.id),
      ConfigMapService.list(),
      GlobalMapService.list(),
    ]);

    const templates: ReadonlyArray<CodeTemplateData> = templatesResult.ok
      ? templatesResult.value.map((t) => ({ code: t.code, type: t.type, contexts: t.contexts }))
      : [];

    // Compile all channel scripts (source + destinations + global)
    const scripts = await this.compileChannelScripts(
      channel, templates, globalScriptsResult, filterTransformerData,
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
    const alertManager = new AlertManager({ logger, emailSender });
    alertManager.loadAlerts(loadedAlerts);

    // Execute global deploy script (before channel deploy)
    if (scripts.globalDeploy) {
      await this.runDeployScript(scripts.globalDeploy, channel, gcm);
    }

    // Execute channel deploy script
    if (scripts.deploy) {
      await this.runDeployScript(scripts.deploy, channel, gcm);
    }

    // Build configMap record (key format: "category.name")
    const configMapRecord: Record<string, unknown> = {};
    if (configMapResult.ok) {
      for (const entry of configMapResult.value) {
        configMapRecord[`${entry.category}.${entry.name}`] = entry.value;
      }
    }

    // Build globalMap proxy with flush-to-DB callback
    const globalMapProxyInstance = new GlobalMapProxy(async (key, value) => {
      await GlobalMapService.upsert(key, value);
    });
    if (globalMapResult.ok) {
      globalMapProxyInstance.load(globalMapResult.value);
    }
    globalMapProxyInstance.start();

    // Build pipeline config
    const pipelineConfig: PipelineConfig = {
      channelId: channel.id,
      serverId: this.serverId,
      dataType: channel.inboundDataType,
      scripts,
      destinations: destConfigs,
      globalChannelMap: gcm,
      globalMapProxy: globalMapProxyInstance,
      configMap: Object.freeze(configMapRecord),
      onError: async (event) => alertManager.handleEvent(event),
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
      return connector.send({
        channelId: channel.id, messageId, metaDataId, content,
        dataType: channel.inboundDataType, correlationId,
      }, signal);
    };

    // Create queue consumers for queued destinations
    const queueConsumers: QueueConsumer[] = [];
    for (const dest of channel.destinations) {
      if (dest.queueMode === 'NEVER') continue;
      const queueConfig: QueueConsumerConfig = {
        channelId: channel.id,
        metaDataId: dest.metaDataId,
        serverId: this.serverId,
        retryCount: dest.retryCount ?? 3,
        retryIntervalMs: dest.retryIntervalMs ?? 10_000,
        batchSize: 10,
        pollIntervalMs: 1_000,
      };
      queueConsumers.push(new QueueConsumer(queueConfig, store, sendFn));
    }

    // Create message processor
    const processor = new MessageProcessor(
      this.sandbox, store, sendFn, pipelineConfig, DEFAULT_EXECUTION_OPTIONS,
    );

    // Build the processMessage callback (used by both source connector and sendMessage API)
    const scriptTimeoutMs = channel.scriptTimeoutSeconds
      ? channel.scriptTimeoutSeconds * 1000
      : 30_000;
    const processMessage = async (rawContent: string, sourceMap?: Record<string, unknown>): Promise<Result<SourceDispatchOutcome>> => {
      // Extract correlationId from sourceMap if present (channel-to-channel routing)
      const correlationId = typeof sourceMap?.['correlationId'] === 'string'
        ? sourceMap['correlationId'] as string
        : undefined;
      const result = await processor.processMessage(
        { rawContent, sourceMap: sourceMap ?? {}, correlationId },
        AbortSignal.timeout(scriptTimeoutMs),
      );
      if (!result.ok) return result;
      // Surface the pipeline's final status so the source connector can build the
      // right response (MLLP: PROCESSED→AA, ERROR→AE, FILTERED→AR).
      const { messageId, response } = result.value;
      const status = toDispatchStatus(result.value.status);
      return { ok: true, value: response === undefined ? { messageId, status } : { messageId, status, response }, error: null };
    };

    // Build runtime config
    const runtimeConfig: ChannelRuntimeConfig = {
      channelId: channel.id,
      source,
      destinations,
      onMessage: async (raw) => processMessage(raw.content, raw.sourceMap),
    };

    const result = await runtime.deploy(runtimeConfig);
    if (!result.ok) {
      throw new Error('Failed to deploy channel runtime');
    }

    this.runtimes.set(channel.id, { channelId: channel.id, runtime, config: channel, globalChannelMap: gcm, globalMapProxy: globalMapProxyInstance, alertManager, queueConsumers, scripts, processMessage });

    // Recover any messages left unprocessed by a prior crash/restart. Best-effort:
    // recovery failures are logged, never allowed to abort a deploy.
    await this.recoverChannel(channel, store, processMessage, sendFn);
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
  async sendMessage(channelId: string, content: string): Promise<Result<{ messageId: number }>> {
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

    // Stop all queue consumers before cleanup
    await Promise.all(deployed.queueConsumers.map((c) => c.stop()));

    // Execute channel undeploy script (before cleanup)
    if (deployed.scripts.undeploy) {
      await this.runDeployScript(deployed.scripts.undeploy, deployed.config, deployed.globalChannelMap);
    }

    // Execute global undeploy script
    if (deployed.scripts.globalUndeploy) {
      await this.runDeployScript(deployed.scripts.globalUndeploy, deployed.config, deployed.globalChannelMap);
    }

    deployed.globalChannelMap.clear();
    deployed.alertManager.clearThrottleState();
    await deployed.globalMapProxy.dispose();

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
  ): Promise<void> {
    // Reset stale PENDING claims for every queued destination.
    for (const dest of channel.destinations) {
      if (dest.queueMode === 'NEVER') continue;
      const reset = await MessageService.resetPending(channel.id, dest.metaDataId);
      if (!reset.ok) {
        logger.error({ channelId: channel.id, metaDataId: dest.metaDataId, errMsg: reset.error.message }, 'Failed to reset PENDING messages');
      }
    }

    const recoveryStore: RecoveryStore = {
      getUnprocessedMessages: async (channelId) => {
        const r = await MessageService.getUnprocessedMessages(channelId);
        if (!r.ok) return r;
        return { ok: true, value: r.value.map((m) => ({ messageId: m.id, channelId: m.channelId })), error: null };
      },
      getConnectorMessages: (channelId, messageId) => MessageService.getConnectorMessages(channelId, messageId),
    };

    const CT_RAW = 1;
    const CT_SENT = 5;

    const reprocessSource = async (channelId: string, messageId: number): Promise<Result<void>> => {
      const raw = await store.loadContent(channelId, messageId, 0, CT_RAW);
      if (!raw.ok || raw.value === null) {
        return { ok: false, value: null, error: new Error('Raw content unavailable for recovery') } as Result<void>;
      }
      const processed = await processMessage(raw.value);
      if (!processed.ok) {
        // Do NOT mark processed on failure — the original still holds recoverable
        // raw content and must remain eligible for recovery on the next deploy.
        // Marking it here would silently lose the message forever.
        return { ok: false, value: null, error: processed.error } as Result<void>;
      }
      // Reprocess succeeded (a new message row was created and run through the
      // pipeline). Mark the original processed so it is not recovered again.
      await MessageService.markProcessed(channelId, messageId);
      return OK_VOID;
    };

    const redispatchDestination = async (channelId: string, messageId: number, metaDataId: number): Promise<Result<void>> => {
      const sent = await store.loadContent(channelId, messageId, metaDataId, CT_SENT);
      if (!sent.ok || sent.value === null) {
        return { ok: false, value: null, error: new Error('Sent content unavailable for recovery') } as Result<void>;
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
  ): Promise<CompiledScript | undefined> {
    const withTemplates = prependTemplates(source, templates, context);
    const result = await compileScript(withTemplates, { sourcefile });
    return result.ok ? result.value : undefined;
  }

  /** Compile channel scripts from stored configuration + DB filter/transformer data + global scripts. */
  private async compileChannelScripts(
    channel: ChannelDetail,
    templates: ReadonlyArray<CodeTemplateData>,
    globalScriptsResult: Awaited<ReturnType<typeof GlobalScriptService.getAll>>,
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
    const sourceFilterScript = compileFilterRulesToScript(ftData.sourceFilterRules);
    if (sourceFilterScript) {
      scripts['sourceFilter'] = await this.compileWithTemplates(
        sourceFilterScript, 'sourceFilter', templates, `${channel.name}/sourceFilter.ts`,
      );
    }

    // Source transformer from transformer steps (connectorId IS NULL)
    const sourceTransformerScript = compileTransformerStepsToScript(ftData.sourceTransformerSteps);
    if (sourceTransformerScript) {
      scripts['sourceTransformer'] = await this.compileWithTemplates(
        sourceTransformerScript, 'sourceTransformer', templates, `${channel.name}/sourceTransformer.ts`,
      );
    }

    // Global preprocessor/postprocessor/deploy/undeploy
    if (globalScriptsResult.ok) {
      const gs = globalScriptsResult.value;
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
        const filterScript = compileFilterRulesToScript(destFilterRules);
        if (filterScript) {
          destScripts['filter'] = await this.compileWithTemplates(
            filterScript, 'destinationFilter', templates, `${channel.name}/${d.name}/filter.ts`,
          );
        }
      }

      // Destination transformer
      const destTransformerSteps = ftData.destinationTransformerSteps.get(d.id);
      if (destTransformerSteps) {
        const txScript = compileTransformerStepsToScript(destTransformerSteps);
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
      });
    }

    return configs;
  }

  /** Wire JavaScript source connector ScriptRunner if applicable. Compiles script once at deploy time. */
  private async wireJavaScriptSource(
    channel: ChannelDetail,
    source: SourceConnectorRuntime,
  ): Promise<void> {
    if (channel.sourceConnectorType !== 'JAVASCRIPT') return;
    const jsReceiver = source as JavaScriptReceiver;
    const sourceScript = (channel.sourceConnectorProperties as { script: string }).script;
    const compiled = await compileScript(sourceScript, { sourcefile: `${channel.name}/js-source.js` });
    if (!compiled.ok) {
      logger.error({ errMsg: compiled.error.message, stack: compiled.error.stack }, 'Failed to compile JS source script');
      return;
    }
    const cachedScript = compiled.value;
    jsReceiver.setScriptRunner(async (_script) => {
      const ctx = { msg: '', tmp: '', rawData: '', sourceMap: {}, channelMap: {}, connectorMap: {}, responseMap: {} };
      const execResult = await this.sandbox.execute(cachedScript, ctx, DEFAULT_EXECUTION_OPTIONS);
      if (!execResult.ok) return execResult;
      return { ok: true as const, value: execResult.value.returnValue, error: null };
    });
  }

  /** Wire JavaScript destination connector ScriptRunners if applicable. Compiles scripts once at deploy time. */
  private async wireJavaScriptDestinations(
    channel: ChannelDetail,
    destinations: Map<number, DestinationConnectorRuntime>,
  ): Promise<void> {
    for (const dest of channel.destinations) {
      if (dest.connectorType !== 'JAVASCRIPT') continue;
      const connector = destinations.get(dest.metaDataId);
      if (!connector) continue;
      const jsDispatcher = connector as JavaScriptDispatcher;
      const destScript = (dest.properties as { script: string }).script;
      const compiled = await compileScript(destScript, { sourcefile: `${channel.name}/js-dest-${String(dest.metaDataId)}.js` });
      if (!compiled.ok) {
        logger.error({ errMsg: compiled.error.message, stack: compiled.error.stack, metaDataId: dest.metaDataId }, 'Failed to compile JS dest script');
        continue;
      }
      const cachedScript = compiled.value;
      jsDispatcher.setScriptRunner(async (_script, content, connectorMessage) => {
        const ctx = { msg: content, tmp: content, rawData: content, sourceMap: {}, channelMap: {}, connectorMap: {}, responseMap: {}, extras: { connectorMessage } };
        const execResult = await this.sandbox.execute(cachedScript, ctx, DEFAULT_EXECUTION_OPTIONS);
        if (!execResult.ok) return execResult;
        return { ok: true as const, value: execResult.value.returnValue, error: null };
      });
    }
  }

  /** Run a deploy/undeploy script in the sandbox with channel context. */
  private async runDeployScript(
    script: CompiledScript,
    channel: ChannelDetail,
    gcm: GlobalChannelMap,
  ): Promise<void> {
    const context = {
      msg: '',
      tmp: '',
      rawData: '',
      sourceMap: {},
      channelMap: {},
      connectorMap: {},
      responseMap: {},
      globalChannelMap: gcm.toRecord(),
      extras: {
        channelId: channel.id,
        channelName: channel.name,
      },
    };
    const result = await this.sandbox.execute(script, context, DEFAULT_EXECUTION_OPTIONS);
    if (result.ok) {
      gcm.applyUpdates(result.value.mapUpdates.globalChannelMap);
    } else {
      logger.error({ errMsg: result.error.message, stack: result.error.stack, channelId: channel.id }, 'Deploy/undeploy script execution failed');
    }
  }

  /** Load alerts applicable to a channel from the database. */
  private async loadAlertsForChannel(channelId: string): Promise<readonly LoadedAlert[]> {
    const listResult = await AlertService.list({ page: 1, pageSize: 1000 });
    if (!listResult.ok) return [];

    const enabledAlerts = listResult.value.data.filter((a) => a.enabled);
    if (enabledAlerts.length === 0) return [];

    // Batch fetch all enabled alert details in a single query
    const ids = enabledAlerts.map((a) => a.id);
    const detailsResult = await AlertService.getByIds(ids);
    if (!detailsResult.ok) return [];

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
    this.sandbox.dispose();
  }
}

// ----- Internal Types -----

interface FilterRuleRow {
  readonly enabled: boolean;
  readonly operator: string;
  readonly type: string;
  readonly script: string | null;
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

// ----- Singleton -----

let engineInstance: EngineManager | null = null;

/** Get or create the engine manager singleton. */
export function getEngine(): EngineManager {
  if (!engineInstance) {
    engineInstance = new EngineManager();
  }
  return engineInstance;
}
