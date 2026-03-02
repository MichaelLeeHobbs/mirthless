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
import { tryCatch } from 'stderr-lib';
import {
  createSourceConnector,
  createDestinationConnector,
  JavaScriptReceiver,
  JavaScriptDispatcher,
  type SourceConnectorRuntime,
  type DestinationConnectorRuntime,
} from '@mirthless/connectors';
import { eq, asc } from 'drizzle-orm';
import { MessageService } from './services/message.service.js';
import { GlobalScriptService } from './services/global-script.service.js';
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
  readonly alertManager: AlertManager;
  readonly queueConsumers: readonly QueueConsumer[];
}

// ----- Message Store Adapter -----

/**
 * Adapts MessageService (static methods) to the MessageStore interface.
 * For advanced queue management (requeueFailed, getQueueDepth), use QueueManagerService directly.
 */
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
    loadContent: (channelId, messageId, metaDataId, contentType) =>
      MessageService.loadContent(channelId, messageId, metaDataId, contentType as Parameters<typeof MessageService.loadContent>[3]),
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
    const gcm = new GlobalChannelMap();

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

    // Load code templates, global scripts, alerts, and filter/transformer data in parallel
    const [templatesResult, globalScriptsResult, filterTransformerData, loadedAlerts] = await Promise.all([
      CodeTemplateService.listTemplates(),
      GlobalScriptService.getAll(),
      this.loadFilterTransformerData(channel.id),
      this.loadAlertsForChannel(channel.id),
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

    // Build pipeline config
    const pipelineConfig: PipelineConfig = {
      channelId: channel.id,
      serverId: this.serverId,
      dataType: channel.inboundDataType,
      scripts,
      destinations: destConfigs,
      globalChannelMap: gcm,
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
      queueConsumers.push(new QueueConsumer(queueConfig, this.store, sendFn));
    }

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

    this.runtimes.set(channel.id, { channelId: channel.id, runtime, config: channel, globalChannelMap: gcm, alertManager, queueConsumers });
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

    // Stop all queue consumers before cleanup
    await Promise.all(deployed.queueConsumers.map((c) => c.stop()));

    deployed.globalChannelMap.clear();
    deployed.alertManager.clearThrottleState();

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

    // Channel preprocessor/postprocessor from channel_scripts table
    for (const script of channel.scripts) {
      if (!script.script) continue;
      const key = script.scriptType.toLowerCase();
      if (key === 'preprocessor' || key === 'postprocessor') {
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

    // Global preprocessor/postprocessor
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
