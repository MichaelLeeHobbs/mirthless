import {
  VmSandboxExecutor,
  MessageProcessor,
  ChannelRuntime,
  QueueConsumer,
  DEFAULT_EXECUTION_OPTIONS,
  compileScript,
  prependTemplates,
} from '@galvanigraph/engine';
import type {
  MessageStore,
  PipelineConfig,
  DestinationConfig,
  DestinationScripts,
  ChannelScripts,
  ChannelRuntimeConfig,
  SendToDestination,
  DestinationResponse,
  CompiledScript,
  CodeTemplateData,
  ProcessedMessage,
} from '@galvanigraph/engine';
import type {
  SourceConnectorRuntime,
  DestinationConnectorRuntime,
  ConnectorMessage,
  ConnectorResponse,
} from '../../../index.js';
import type { Result } from '@galvanigraph/core-util';

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

/** Maps status as the server's `toDispatchStatus` does under the default response mode. */
export function toDispatchResult(result: Result<ProcessedMessage>): Awaited<ReturnType<ChannelRuntimeConfig['onMessage']>> {
  if (!result.ok) return result;
  const { messageId, status, response, queued } = result.value;
  const dispatchStatus = status === 'FILTERED' ? 'FILTERED' : status === 'ERROR' ? 'ERROR' : 'PROCESSED';
  return ok({
    messageId,
    status: dispatchStatus,
    ...(response === undefined ? {} : { response }),
    ...(queued ? { queued } : {}),
  });
}

export interface StoredContentRow {
  readonly channelId: string;
  readonly messageId: number;
  readonly metaDataId: number;
  readonly contentType: number;
  readonly content: string;
  readonly dataType: string;
}

export interface StoredConnectorMessageRow {
  readonly channelId: string;
  readonly messageId: number;
  readonly metaDataId: number;
  readonly connectorName: string;
  status: string;
  /** Failed queued deliveries so far (the server counts them the same way). */
  sendAttempts: number;
}

export interface StoredStatRow {
  readonly channelId: string;
  readonly metaDataId: number;
  received: number;
  filtered: number;
  sent: number;
  errored: number;
}

export interface StoredMessageRow {
  readonly channelId: string;
  readonly messageId: number;
  processed: boolean;
}

export interface InMemoryStore extends MessageStore {
  readonly messages: readonly StoredMessageRow[];
  readonly contents: readonly StoredContentRow[];
  readonly connectorMessages: readonly StoredConnectorMessageRow[];
  readonly stats: readonly StoredStatRow[];
  messageCount(): number;
  contentOf(messageId: number, metaDataId: number, contentType: number): string | null;
}

export function createInMemoryStore(): InMemoryStore {
  let nextMessageId = 1;
  const messages: StoredMessageRow[] = [];
  const connectorMessages: StoredConnectorMessageRow[] = [];
  const contents: StoredContentRow[] = [];
  const stats: StoredStatRow[] = [];

  const findConnectorMessage = (channelId: string, messageId: number, metaDataId: number): StoredConnectorMessageRow | undefined =>
    connectorMessages.find((m) => m.channelId === channelId && m.messageId === messageId && m.metaDataId === metaDataId);

  return {
    messages,
    contents,
    connectorMessages,
    stats,
    messageCount: () => messages.length,
    contentOf: (messageId, metaDataId, contentType) =>
      contents.find(
        (c) => c.messageId === messageId && c.metaDataId === metaDataId && c.contentType === contentType,
      )?.content ?? null,

    createMessage: async (channelId, _serverId, correlationId) => {
      const messageId = nextMessageId++;
      messages.push({ channelId, messageId, processed: false });
      return ok({ messageId, correlationId: correlationId ?? `corr-${channelId}-${String(messageId)}` });
    },
    createConnectorMessage: async (channelId, messageId, metaDataId, name, status) => {
      connectorMessages.push({ channelId, messageId, metaDataId, connectorName: name, status, sendAttempts: 0 });
      return ok(undefined);
    },
    updateConnectorMessageStatus: async (channelId, messageId, metaDataId, status) => {
      const cm = findConnectorMessage(channelId, messageId, metaDataId);
      if (cm) {
        // A claimed message going back on the queue is a failed attempt.
        if (cm.status === 'PENDING' && status === 'QUEUED') cm.sendAttempts += 1;
        cm.status = status;
      }
      return ok(undefined);
    },
    storeContent: async (channelId, messageId, metaDataId, contentType, content, dataType) => {
      contents.push({ channelId, messageId, metaDataId, contentType, content, dataType });
      return ok(undefined);
    },
    markProcessed: async (channelId, messageId) => {
      const msg = messages.find((m) => m.channelId === channelId && m.messageId === messageId);
      if (msg) msg.processed = true;
      return ok(undefined);
    },
    enqueue: async (channelId, messageId, metaDataId) => {
      const cm = findConnectorMessage(channelId, messageId, metaDataId);
      if (cm) cm.status = 'QUEUED';
      return ok(undefined);
    },
    loadContent: async (channelId, messageId, metaDataId, contentType) => {
      const entry = contents.find(
        (c) => c.channelId === channelId && c.messageId === messageId
          && c.metaDataId === metaDataId && c.contentType === contentType,
      );
      return ok(entry?.content ?? null);
    },
    // Claims QUEUED rows as PENDING, as MessageService.dequeue does.
    dequeue: async (channelId, metaDataId, batchSize) => {
      const claimed = connectorMessages
        .filter((m) => m.channelId === channelId && m.metaDataId === metaDataId && m.status === 'QUEUED')
        .slice(0, batchSize);
      for (const m of claimed) m.status = 'PENDING';
      return ok(claimed.map(({ messageId, sendAttempts }) => ({ channelId, messageId, metaDataId, sendAttempts })));
    },
    release: async (channelId, messageId, metaDataId, newStatus) => {
      const cm = findConnectorMessage(channelId, messageId, metaDataId);
      if (cm) cm.status = newStatus;
      return ok(undefined);
    },
    // As MessageService.isFullyDelivered: every connector SENT or FILTERED.
    isFullyDelivered: async (channelId, messageId) => {
      const rows = connectorMessages.filter((m) => m.channelId === channelId && m.messageId === messageId);
      return ok(rows.length > 0 && rows.every((m) => m.status === 'SENT' || m.status === 'FILTERED'));
    },
    incrementStats: async (channelId, metaDataId, _serverId, field) => {
      let stat = stats.find((s) => s.channelId === channelId && s.metaDataId === metaDataId);
      if (!stat) {
        stat = { channelId, metaDataId, received: 0, filtered: 0, sent: 0, errored: 0 };
        stats.push(stat);
      }
      stat[field] += 1;
      return ok(undefined);
    },
  };
}

export interface DestinationSpec {
  readonly metaDataId: number;
  readonly name: string;
  readonly connector: DestinationConnectorRuntime;
  /** Defaults to the channel's dataType. */
  readonly dataType?: string;
  readonly filter?: string;
  readonly transformer?: string;
  readonly responseTransformer?: string;
  /** Queue the destination (default NEVER). A queued destination gets a running queue consumer. */
  readonly queueMode?: 'NEVER' | 'ON_FAILURE' | 'ALWAYS';
  /** Wait between queued delivery attempts (default 200 ms). */
  readonly retryIntervalMs?: number;
}

export interface ChannelSpec {
  readonly channelId: string;
  readonly serverId?: string;
  readonly dataType: string;
  readonly source: SourceConnectorRuntime;
  readonly templates?: ReadonlyArray<CodeTemplateData>;
  readonly preprocessor?: string;
  /** `return true` to pass. */
  readonly filter?: string;
  readonly transformer?: string;
  readonly destinations: ReadonlyArray<DestinationSpec>;
  /** A fresh in-memory store when absent. */
  readonly store?: InMemoryStore;
}

export interface DeployedChannel {
  readonly runtime: ChannelRuntime;
  readonly store: InMemoryStore;
  teardown(): Promise<void>;
}

async function compile(
  code: string,
  templates: ReadonlyArray<CodeTemplateData>,
  context: string,
  sourcefile: string,
): Promise<CompiledScript> {
  const withTemplates = prependTemplates(code, templates, context);
  const result = await compileScript(withTemplates, { sourcefile });
  if (!result.ok) {
    throw new Error(`compile failed for ${sourcefile}: ${result.error.message}`);
  }
  return result.value;
}

async function buildDestinationConfigs(
  spec: ChannelSpec,
  templates: ReadonlyArray<CodeTemplateData>,
): Promise<DestinationConfig[]> {
  const configs: DestinationConfig[] = [];
  for (const d of spec.destinations) {
    const scripts: {
      filter?: CompiledScript;
      transformer?: CompiledScript;
      responseTransformer?: CompiledScript;
    } = {};
    const base = `${spec.channelId}/dest-${String(d.metaDataId)}`;
    if (d.filter !== undefined) {
      scripts.filter = await compile(d.filter, templates, 'destinationFilter', `${base}-filter.ts`);
    }
    if (d.transformer !== undefined) {
      scripts.transformer = await compile(d.transformer, templates, 'destinationTransformer', `${base}-transformer.ts`);
    }
    if (d.responseTransformer !== undefined) {
      // Note: CONTEXT_MAP has no response-transformer key, so template injection
      // is a no-op here (templates are unavailable in response transformers).
      scripts.responseTransformer = await compile(
        d.responseTransformer, templates, 'destinationResponseTransformer', `${base}-response.ts`,
      );
    }
    configs.push({
      metaDataId: d.metaDataId,
      name: d.name,
      enabled: true,
      scripts: scripts as DestinationScripts,
      queueMode: d.queueMode ?? 'NEVER',
    });
  }
  return configs;
}

export async function deployChannel(spec: ChannelSpec): Promise<DeployedChannel> {
  const sandbox = new VmSandboxExecutor();
  const store = spec.store ?? createInMemoryStore();
  const serverId = spec.serverId ?? 'e2e-server';
  const templates = spec.templates ?? [];

  const sourceScripts: {
    preprocessor?: CompiledScript;
    sourceFilter?: CompiledScript;
    sourceTransformer?: CompiledScript;
  } = {};
  if (spec.preprocessor !== undefined) {
    sourceScripts.preprocessor = await compile(
      spec.preprocessor, templates, 'preprocessor', `${spec.channelId}/preprocessor.ts`,
    );
  }
  if (spec.filter !== undefined) {
    sourceScripts.sourceFilter = await compile(
      spec.filter, templates, 'sourceFilter', `${spec.channelId}/source-filter.ts`,
    );
  }
  if (spec.transformer !== undefined) {
    sourceScripts.sourceTransformer = await compile(
      spec.transformer, templates, 'sourceTransformer', `${spec.channelId}/source-transformer.ts`,
    );
  }

  const destConfigs = await buildDestinationConfigs(spec, templates);

  const pipelineConfig: PipelineConfig = {
    channelId: spec.channelId,
    serverId,
    dataType: spec.dataType,
    scripts: sourceScripts as ChannelScripts,
    destinations: destConfigs,
  };

  const destByMeta = new Map(spec.destinations.map((d) => [d.metaDataId, d]));
  const sendFn: SendToDestination = async (metaDataId, messageId, content, signal, _correlationId, variables) => {
    const d = destByMeta.get(metaDataId);
    if (!d) {
      return ok<DestinationResponse>({ status: 'ERROR', content: '', errorMessage: `unknown destination ${String(metaDataId)}` });
    }
    const message: ConnectorMessage = {
      channelId: spec.channelId,
      messageId,
      metaDataId,
      content,
      dataType: d.dataType ?? spec.dataType,
      // As the server engine does, so destinations can fill `${name}` per message.
      variables,
    };
    return d.connector.send(message, signal);
  };

  const processor = new MessageProcessor(sandbox, store, sendFn, pipelineConfig, DEFAULT_EXECUTION_OPTIONS);

  const runtime = new ChannelRuntime();
  const destinations = new Map<number, DestinationConnectorRuntime>(
    spec.destinations.map((d) => [d.metaDataId, d.connector]),
  );
  const runtimeConfig: ChannelRuntimeConfig = {
    channelId: spec.channelId,
    source: spec.source,
    destinations,
    onMessage: async (raw) => toDispatchResult(await processor.processMessage(
      { rawContent: raw.content, sourceMap: raw.sourceMap },
      AbortSignal.timeout(30_000),
    )),
  };

  const queueConsumers = spec.destinations
    .filter((d) => (d.queueMode ?? 'NEVER') !== 'NEVER')
    .map((d) => new QueueConsumer({
      channelId: spec.channelId,
      metaDataId: d.metaDataId,
      serverId,
      retryCount: 0,
      retryIntervalMs: d.retryIntervalMs ?? 200,
      batchSize: 10,
      pollIntervalMs: 100,
      // As the server wires it (engine.ts).
      onMessageDelivered: spec.source.onMessageDelivered
        ? (_messageId, rawContent) => spec.source.onMessageDelivered?.(rawContent) ?? Promise.resolve()
        : undefined,
    }, store, sendFn));

  const deployResult = await runtime.deploy(runtimeConfig);
  if (!deployResult.ok) throw new Error(`deploy failed: ${deployResult.error.message}`);
  const startResult = await runtime.start();
  if (!startResult.ok) throw new Error(`start failed: ${startResult.error.message}`);
  for (const consumer of queueConsumers) consumer.start();

  return {
    runtime,
    store,
    teardown: async () => {
      for (const consumer of queueConsumers) await consumer.stop();
      const state = runtime.getState();
      if (state === 'STARTED' || state === 'PAUSED') await runtime.stop();
      if (runtime.getState() === 'STOPPED') await runtime.undeploy();
    },
  };
}

export async function teardownAll(channels: readonly DeployedChannel[]): Promise<void> {
  for (const c of channels) {
    await c.teardown();
  }
}

export class CaptureDestination implements DestinationConnectorRuntime {
  readonly received: ConnectorMessage[] = [];
  private readonly reply: (msg: ConnectorMessage) => string;

  constructor(reply?: (msg: ConnectorMessage) => string) {
    this.reply = reply ?? (() => 'ACK');
  }

  lastContent(): string | null {
    return this.received.at(-1)?.content ?? null;
  }

  async onDeploy(): Promise<Result<void>> { return ok(undefined); }
  async onStart(): Promise<Result<void>> { return ok(undefined); }
  async onStop(): Promise<Result<void>> { return ok(undefined); }
  async onHalt(): Promise<Result<void>> { return ok(undefined); }
  async onUndeploy(): Promise<Result<void>> { return ok(undefined); }

  async send(message: ConnectorMessage, _signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    this.received.push(message);
    return ok<ConnectorResponse>({ status: 'SENT', content: this.reply(message) });
  }
}
