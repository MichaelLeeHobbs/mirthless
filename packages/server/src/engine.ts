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
  type ChannelRuntimeConfig,
  type PipelineConfig,
  type ChannelScripts,
  type DestinationConfig,
  type DestinationScripts,
  type SandboxExecutor,
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
  type SourceConnectorRuntime,
  type DestinationConnectorRuntime,
} from '@mirthless/connectors';
import { MESSAGE_STORAGE_MODE, CONTENT_TYPE, type MessageStorageMode } from '@mirthless/core-models';
import { eq, asc } from 'drizzle-orm';
import { MessageService } from './services/message.service.js';
import { GlobalScriptService } from './services/global-script.service.js';
import { GlobalMapService } from './services/global-map.service.js';
import { ConfigMapService } from './services/config-map.service.js';
import { CodeTemplateService } from './services/code-template.service.js';
import { AlertService } from './services/alert.service.js';
import { EmailService } from './services/email.service.js';
import { db } from './lib/db.js';
import { channelFilters, filterRules, channelTransformers, transformerSteps } from './db/schema/index.js';
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
  readonly processMessage: (rawContent: string, sourceMap?: Record<string, unknown>) => Promise<Result<{ messageId: number }>>;
}

// ----- Storage Policy -----

/** Per-channel storage configuration captured from channel settings. */
export interface StorageConfig {
  readonly messageStorageMode: MessageStorageMode;
  readonly removeContentOnCompletion: boolean;
  readonly removeAttachmentsOnCompletion: boolean;
}

const OK_VOID = { ok: true as const, value: undefined, error: null } as Result<void>;

/**
 * Determines whether a given content type should be stored based on the storage mode.
 * Error content types (11-13) are stored in DEVELOPMENT, PRODUCTION, and RAW modes.
 */
export function shouldStoreContent(mode: MessageStorageMode, contentType: number): boolean {
  if (mode === MESSAGE_STORAGE_MODE.DEVELOPMENT) return true;
  if (mode === MESSAGE_STORAGE_MODE.PRODUCTION) return contentType >= CONTENT_TYPE.ERROR;
  if (mode === MESSAGE_STORAGE_MODE.RAW) return contentType === CONTENT_TYPE.RAW || contentType >= CONTENT_TYPE.ERROR;
  // METADATA, DISABLED: no content stored
  return false;
}

// ----- Message Store Adapter -----

/**
 * Adapts MessageService (static methods) to the MessageStore interface.
 * When a StorageConfig is provided, filters storeContent calls by storage mode
 * and handles content/attachment cleanup on completion.
 */
function createMessageStoreAdapter(config?: StorageConfig): MessageStore {
  const mode = config?.messageStorageMode ?? MESSAGE_STORAGE_MODE.DEVELOPMENT;
  return {
    createMessage: (channelId, serverId) =>
      MessageService.createMessage(channelId, serverId),
    createConnectorMessage: (channelId, messageId, metaDataId, name, status) =>
      MessageService.createConnectorMessage(channelId, messageId, metaDataId, name, status as Parameters<typeof MessageService.createConnectorMessage>[4]),
    updateConnectorMessageStatus: (channelId, messageId, metaDataId, status, errorCode) =>
      MessageService.updateConnectorMessageStatus(channelId, messageId, metaDataId, status as Parameters<typeof MessageService.updateConnectorMessageStatus>[3], errorCode),
    storeContent: (channelId, messageId, metaDataId, contentType, content, dataType) => {
      if (!shouldStoreContent(mode, contentType)) {
        return Promise.resolve(OK_VOID);
      }
      return MessageService.storeContent(channelId, messageId, metaDataId, contentType as Parameters<typeof MessageService.storeContent>[3], content, dataType);
    },
    markProcessed: async (channelId, messageId) => {
      const result = await MessageService.markProcessed(channelId, messageId);
      if (result.ok && (config?.removeContentOnCompletion || config?.removeAttachmentsOnCompletion)) {
        const deletes: Promise<Result<void>>[] = [];
        if (config?.removeContentOnCompletion) {
          deletes.push(MessageService.deleteContent(channelId, messageId));
        }
        if (config?.removeAttachmentsOnCompletion) {
          deletes.push(MessageService.deleteAttachments(channelId, messageId));
        }
        await Promise.all(deletes);
      }
      return result;
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
  };
}

// ----- Engine Manager -----

export class EngineManager {
  private readonly runtimes = new Map<string, DeployedChannel>();
  private readonly sandbox: SandboxExecutor;
  private readonly serverId: string;

  constructor(serverId?: string) {
    this.sandbox = new VmSandboxExecutor();
    this.serverId = serverId ?? 'server-01';
  }

  /** Deploy a channel from its stored configuration. */
  async deploy(channel: ChannelDetail): Promise<void> {
    if (this.runtimes.has(channel.id)) {
      throw new Error(`Channel ${channel.id} is already deployed`);
    }

    const runtime = new ChannelRuntime();
    const gcm = new GlobalChannelMap();

    // Create per-channel message store adapter with storage policy
    const store = createMessageStoreAdapter({
      messageStorageMode: channel.messageStorageMode as MessageStorageMode,
      removeContentOnCompletion: channel.removeContentOnCompletion,
      removeAttachmentsOnCompletion: channel.removeAttachmentsOnCompletion,
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
        logger.error({ error: result.error }, 'Failed to send alert email');
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
    };

    // Build send function
    const sendFn: SendToDestination = async (metaDataId, content, signal) => {
      const connector = destinations.get(metaDataId);
      if (!connector) {
        return tryCatch(() => { throw new Error(`Destination ${String(metaDataId)} not found`); });
      }
      return connector.send({ channelId: channel.id, messageId: 0, metaDataId, content, dataType: channel.inboundDataType }, signal);
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
    const processMessage = async (rawContent: string, sourceMap?: Record<string, unknown>): Promise<Result<{ messageId: number }>> => {
      return processor.processMessage(
        { rawContent, sourceMap: sourceMap ?? {} },
        AbortSignal.timeout(scriptTimeoutMs),
      );
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
        queueEnabled: d.queueMode !== 'NEVER',
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
      logger.error({ error: compiled.error }, 'Failed to compile JS source script');
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
        logger.error({ error: compiled.error, metaDataId: dest.metaDataId }, 'Failed to compile JS dest script');
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
      logger.error({ error: result.error, channelId: channel.id }, 'Deploy/undeploy script execution failed');
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
