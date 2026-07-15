// ===========================================
// E2E Channel Harness
// ===========================================
// Reusable support for tests that ACTUALLY send messages through channels.
// Assembles a real channel runtime (sandbox + 8-stage pipeline + real source
// and destination connectors) backed by an in-memory message store, so a test
// can: build a channel from a declarative spec, push a message in through the
// source connector, and assert on the transformed output + persisted rows.
//
// Scripts (source filter/transformer, per-destination filter/transformer/
// response-transformer) are written as TS/JS source and compiled through the
// real esbuild-backed compiler with code-template injection — exercising the
// same path production uses. No mocking of anything we own.

import {
  VmSandboxExecutor,
  MessageProcessor,
  ChannelRuntime,
  DEFAULT_EXECUTION_OPTIONS,
  compileScript,
  prependTemplates,
} from '../../index.js';
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
} from '../../index.js';
import type {
  SourceConnectorRuntime,
  DestinationConnectorRuntime,
  ConnectorMessage,
  ConnectorResponse,
} from '@mirthless/connectors';
import type { Result } from '@mirthless/core-util';

// ----- Result helper -----

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

// ----- In-memory message store -----

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
}

export interface StoredStatRow {
  readonly channelId: string;
  readonly metaDataId: number;
  received: number;
  filtered: number;
  sent: number;
  errored: number;
}

export interface InMemoryStore extends MessageStore {
  readonly contents: readonly StoredContentRow[];
  readonly connectorMessages: readonly StoredConnectorMessageRow[];
  readonly stats: readonly StoredStatRow[];
  /** Number of source messages created. */
  messageCount(): number;
  /** Content of a specific stored row, or null. */
  contentOf(messageId: number, metaDataId: number, contentType: number): string | null;
}

/** Build a fresh in-memory store fully satisfying the MessageStore contract. */
export function createInMemoryStore(): InMemoryStore {
  let nextMessageId = 1;
  const messages: { channelId: string; messageId: number; processed: boolean }[] = [];
  const connectorMessages: StoredConnectorMessageRow[] = [];
  const contents: StoredContentRow[] = [];
  const stats: StoredStatRow[] = [];

  return {
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
      connectorMessages.push({ channelId, messageId, metaDataId, connectorName: name, status });
      return ok(undefined);
    },
    updateConnectorMessageStatus: async (channelId, messageId, metaDataId, status) => {
      const cm = connectorMessages.find(
        (m) => m.channelId === channelId && m.messageId === messageId && m.metaDataId === metaDataId,
      );
      if (cm) cm.status = status;
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
    enqueue: async () => ok(undefined),
    loadContent: async (channelId, messageId, metaDataId, contentType) => {
      const entry = contents.find(
        (c) => c.channelId === channelId && c.messageId === messageId
          && c.metaDataId === metaDataId && c.contentType === contentType,
      );
      return ok(entry?.content ?? null);
    },
    dequeue: async () => ok([]),
    release: async () => ok(undefined),
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

// ----- Channel spec -----

export interface DestinationSpec {
  readonly metaDataId: number;
  readonly name: string;
  readonly connector: DestinationConnectorRuntime;
  /** dataType tagged on the outbound ConnectorMessage; defaults to channel dataType. */
  readonly dataType?: string;
  readonly filter?: string;
  readonly transformer?: string;
  readonly responseTransformer?: string;
}

export interface ChannelSpec {
  readonly channelId: string;
  readonly serverId?: string;
  readonly dataType: string;
  readonly source: SourceConnectorRuntime;
  readonly templates?: ReadonlyArray<CodeTemplateData>;
  /** Channel preprocessor script. */
  readonly preprocessor?: string;
  /** Source filter script (`return true` to pass). */
  readonly filter?: string;
  /** Source transformer script. */
  readonly transformer?: string;
  readonly destinations: ReadonlyArray<DestinationSpec>;
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
      queueMode: 'NEVER',
    });
  }
  return configs;
}

/**
 * Assemble, deploy, and start a channel from a declarative spec.
 * The returned channel is live: pushing a message through `spec.source`
 * runs the full pipeline and dispatches to the real destination connectors.
 */
export async function deployChannel(spec: ChannelSpec): Promise<DeployedChannel> {
  const sandbox = new VmSandboxExecutor();
  const store = createInMemoryStore();
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
  const sendFn: SendToDestination = async (metaDataId, messageId, content, signal) => {
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
    onMessage: async (raw) => {
      const result = await processor.processMessage(
        { rawContent: raw.content, sourceMap: raw.sourceMap },
        AbortSignal.timeout(30_000),
      );
      if (!result.ok) return result;
      // Map the pipeline's SENT success status to the source-dispatch PROCESSED
      // status the runtime/source connectors expect (same as production engine).
      const { messageId, status, response } = result.value;
      const dispatchStatus = status === 'FILTERED' ? 'FILTERED' : status === 'ERROR' ? 'ERROR' : 'PROCESSED';
      return ok(response !== undefined
        ? { messageId, status: dispatchStatus, response }
        : { messageId, status: dispatchStatus });
    },
  };

  const deployResult = await runtime.deploy(runtimeConfig);
  if (!deployResult.ok) throw new Error(`deploy failed: ${deployResult.error.message}`);
  const startResult = await runtime.start();
  if (!startResult.ok) throw new Error(`start failed: ${startResult.error.message}`);

  return {
    runtime,
    store,
    teardown: async () => {
      const state = runtime.getState();
      if (state === 'STARTED' || state === 'PAUSED') await runtime.stop();
      if (runtime.getState() === 'STOPPED') await runtime.undeploy();
    },
  };
}

/** Stop and undeploy several channels, ignoring already-stopped ones. */
export async function teardownAll(channels: readonly DeployedChannel[]): Promise<void> {
  for (const c of channels) {
    await c.teardown();
  }
}

// ----- Capture destination (an in-memory sink connector) -----

/**
 * A real DestinationConnectorRuntime that records every message it is sent.
 * Use as the terminal sink of a chain to assert on the final transformed output
 * without needing an external server. It IS a real connector (implements the
 * full lifecycle + send contract) — the message genuinely flows through the
 * pipeline and dispatch path to reach it.
 */
export class CaptureDestination implements DestinationConnectorRuntime {
  readonly received: ConnectorMessage[] = [];
  private readonly reply: (msg: ConnectorMessage) => string;

  constructor(reply?: (msg: ConnectorMessage) => string) {
    this.reply = reply ?? (() => 'ACK');
  }

  /** Content of the most recently received message, or null. */
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
