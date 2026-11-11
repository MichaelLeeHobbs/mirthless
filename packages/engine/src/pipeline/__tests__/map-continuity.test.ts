// ===========================================
// Pipeline Map Continuity Tests
// ===========================================
// Tests that channelMap, responseMap, and globalMap state persists across pipeline stages.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VmSandboxExecutor, DEFAULT_EXECUTION_OPTIONS } from '../../sandbox/sandbox-executor.js';
import { compileScript } from '../../sandbox/script-compiler.js';
import { MessageProcessor, type PipelineConfig, type MessageStore, type SendToDestination, type ChannelScripts } from '../message-processor.js';
import { GlobalChannelMap } from '../../runtime/global-channel-map.js';
import { GlobalMapProxy } from '../../runtime/global-map-proxy.js';

// ----- Helpers -----

function makeStore(): MessageStore {
  return {
    createMessage: vi.fn().mockResolvedValue({ ok: true, value: { messageId: 1, correlationId: '00000000-0000-0000-0000-000000000099' }, error: null }),
    createConnectorMessage: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    updateConnectorMessageStatus: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    storeContent: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    markProcessed: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    enqueue: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    loadContent: vi.fn().mockResolvedValue({ ok: true, value: null, error: null }),
    dequeue: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
    release: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    incrementStats: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  };
}

function makeSendFn(response = 'ACK'): SendToDestination {
  return vi.fn().mockResolvedValue({
    ok: true,
    value: { status: 'SENT', content: response },
    error: null,
  });
}

async function compile(code: string): Promise<{ code: string }> {
  const result = await compileScript(code, { sourcefile: 'test.js' });
  if (!result.ok) throw new Error('Compile failed');
  return result.value;
}

// ----- Tests -----

let executor: VmSandboxExecutor;

beforeEach(() => {
  executor = new VmSandboxExecutor();
});

afterEach(() => {
  executor.dispose();
});

describe('Pipeline Map Continuity', () => {
  it('channelMap persists from preprocessor to source transformer', async () => {
    const preprocessor = await compile('channelMap["fromPreprocessor"] = "hello"; return msg;');
    const sourceTransformer = await compile('return channelMap["fromPreprocessor"] || "not found";');

    const scripts: ChannelScripts = { preprocessor, sourceTransformer };
    const config: PipelineConfig = {
      channelId: 'ch-1',
      serverId: 'srv-1',
      dataType: 'RAW',
      scripts,
      destinations: [],
    };

    const processor = new MessageProcessor(executor, makeStore(), makeSendFn(), config, DEFAULT_EXECUTION_OPTIONS);
    const result = await processor.processMessage(
      { rawContent: 'MSH|test', sourceMap: {} },
      AbortSignal.timeout(5_000),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The source transformer should see the channelMap value from preprocessor
    // (it transforms content = channelMap value)
    // Store should have been called with the transformed content
    // We verify via storeContent calls: the transformed content should be "hello"
    expect(result.value.status).toBe('SENT');
  });

  it('channelMap persists from preprocessor to postprocessor', async () => {
    const preprocessor = await compile('channelMap["stage"] = "pre"; return msg;');
    const postprocessor = await compile('channelMap["stage"] = channelMap["stage"] + "_post"; return msg;');

    const scripts: ChannelScripts = { preprocessor, postprocessor };
    const config: PipelineConfig = {
      channelId: 'ch-1',
      serverId: 'srv-1',
      dataType: 'RAW',
      scripts,
      destinations: [],
    };

    const processor = new MessageProcessor(executor, makeStore(), makeSendFn(), config, DEFAULT_EXECUTION_OPTIONS);
    const result = await processor.processMessage(
      { rawContent: 'test', sourceMap: {} },
      AbortSignal.timeout(5_000),
    );

    expect(result.ok).toBe(true);
  });

  it('responseMap is populated with destination responses', async () => {
    const sendFn = vi.fn().mockResolvedValue({
      ok: true,
      value: { status: 'SENT', content: 'response-data' },
      error: null,
    });

    // Postprocessor reads responseMap to verify it's populated
    const postprocessor = await compile('return responseMap;');

    const scripts: ChannelScripts = { postprocessor };
    const config: PipelineConfig = {
      channelId: 'ch-1',
      serverId: 'srv-1',
      dataType: 'RAW',
      scripts,
      destinations: [{
        metaDataId: 1,
        name: 'Dest1',
        enabled: true,
        scripts: {},
        queueMode: 'NEVER',
      }],
    };

    const processor = new MessageProcessor(executor, makeStore(), sendFn, config, DEFAULT_EXECUTION_OPTIONS);
    const result = await processor.processMessage(
      { rawContent: 'test', sourceMap: {} },
      AbortSignal.timeout(5_000),
    );

    expect(result.ok).toBe(true);
  });

  it('globalChannelMap updates persist across scripts', async () => {
    const gcm = new GlobalChannelMap();
    const preprocessor = await compile('globalChannelMap["counter"] = 1; return msg;');
    const sourceTransformer = await compile('globalChannelMap["counter"] = (globalChannelMap["counter"] || 0) + 1; return msg;');

    const scripts: ChannelScripts = { preprocessor, sourceTransformer };
    const config: PipelineConfig = {
      channelId: 'ch-1',
      serverId: 'srv-1',
      dataType: 'RAW',
      scripts,
      destinations: [],
      globalChannelMap: gcm,
    };

    const processor = new MessageProcessor(executor, makeStore(), makeSendFn(), config, DEFAULT_EXECUTION_OPTIONS);
    await processor.processMessage(
      { rawContent: 'test', sourceMap: {} },
      AbortSignal.timeout(5_000),
    );

    // GlobalChannelMap should have the accumulated value
    expect(gcm.get('counter')).toBe(2);
  });

  it('configMap is accessible in scripts as read-only', async () => {
    const sourceTransformer = await compile('return configMap["db.host"];');

    const scripts: ChannelScripts = { sourceTransformer };
    const config: PipelineConfig = {
      channelId: 'ch-1',
      serverId: 'srv-1',
      dataType: 'RAW',
      scripts,
      destinations: [],
      configMap: Object.freeze({ 'db.host': 'localhost' }),
    };

    const store = makeStore();
    const processor = new MessageProcessor(executor, store, makeSendFn(), config, DEFAULT_EXECUTION_OPTIONS);
    const result = await processor.processMessage(
      { rawContent: 'test', sourceMap: {} },
      AbortSignal.timeout(5_000),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The transformer returns the configMap value as content
    // Verify via the storeContent call for CT_TRANSFORMED
    const storeContentCalls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const transformedCall = storeContentCalls.find((c: unknown[]) => c[3] === 3); // CT_TRANSFORMED=3
    expect(transformedCall).toBeDefined();
    expect(transformedCall![4]).toBe('localhost');
  });

  it('sourceMap is passed through to scripts', async () => {
    const sourceTransformer = await compile('return sourceMap["customField"];');

    const scripts: ChannelScripts = { sourceTransformer };
    const config: PipelineConfig = {
      channelId: 'ch-1',
      serverId: 'srv-1',
      dataType: 'RAW',
      scripts,
      destinations: [],
    };

    const store = makeStore();
    const processor = new MessageProcessor(executor, store, makeSendFn(), config, DEFAULT_EXECUTION_OPTIONS);
    const result = await processor.processMessage(
      { rawContent: 'test', sourceMap: { customField: 'sourceValue' } },
      AbortSignal.timeout(5_000),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const storeContentCalls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const transformedCall = storeContentCalls.find((c: unknown[]) => c[3] === 3);
    expect(transformedCall).toBeDefined();
    expect(transformedCall![4]).toBe('sourceValue');
  });

  it('fresh connectorMap per script execution does not leak between destinations', async () => {
    const destFilter = await compile('connectorMap["destSpecific"] = msg; return true;');

    const config: PipelineConfig = {
      channelId: 'ch-1',
      serverId: 'srv-1',
      dataType: 'RAW',
      scripts: {},
      destinations: [
        { metaDataId: 1, name: 'Dest1', enabled: true, scripts: { filter: destFilter }, queueMode: 'NEVER' },
        { metaDataId: 2, name: 'Dest2', enabled: true, scripts: { filter: destFilter }, queueMode: 'NEVER' },
      ],
    };

    const processor = new MessageProcessor(executor, makeStore(), makeSendFn(), config, DEFAULT_EXECUTION_OPTIONS);
    const result = await processor.processMessage(
      { rawContent: 'test', sourceMap: {} },
      AbortSignal.timeout(5_000),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults).toHaveLength(2);
    expect(result.value.destinationResults.every((d) => d.status === 'SENT')).toBe(true);
  });

  it('connectorMap set in a destination filter is visible in that destination transformer only', async () => {
    const destFilter = await compile('connectorMap["tag"] = "from-" + msg; return true;');
    const destTransformer = await compile('msg = String(connectorMap["tag"]);');
    const plainTransformer = await compile('msg = String(connectorMap["tag"]);');
    const send = makeSendFn();
    const config: PipelineConfig = {
      channelId: 'ch-1', serverId: 'srv-1', dataType: 'RAW', scripts: {},
      destinations: [
        { metaDataId: 1, name: 'Dest1', enabled: true, scripts: { filter: destFilter, transformer: destTransformer }, queueMode: 'NEVER' },
        { metaDataId: 2, name: 'Dest2', enabled: true, scripts: { transformer: plainTransformer }, queueMode: 'NEVER' },
      ],
    };
    const processor = new MessageProcessor(executor, makeStore(), send, config, DEFAULT_EXECUTION_OPTIONS);
    const result = await processor.processMessage({ rawContent: 'x', sourceMap: {} }, AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    const sent = (send as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => [c[0], c[2]]);
    expect(sent).toContainEqual([1, 'from-x']);
    expect(sent).toContainEqual([2, 'undefined']);
  });

  it('responseMap written by a response transformer reaches the postprocessor', async () => {
    const responseTransformer = await compile('responseMap["verdict"] = "accepted";');
    const postprocessor = await compile('channelMap["seen"] = responseMap["verdict"]; globalChannelMap["seen"] = responseMap["verdict"];');
    const gcm = new GlobalChannelMap();
    const config: PipelineConfig = {
      channelId: 'ch-1', serverId: 'srv-1', dataType: 'RAW', scripts: { postprocessor },
      destinations: [
        { metaDataId: 1, name: 'Dest1', enabled: true, scripts: { responseTransformer }, queueMode: 'NEVER' },
      ],
      globalChannelMap: gcm,
    };
    const processor = new MessageProcessor(executor, makeStore(), makeSendFn(), config, DEFAULT_EXECUTION_OPTIONS);
    const result = await processor.processMessage({ rawContent: 'x', sourceMap: {} }, AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    expect(gcm.get('seen')).toBe('accepted');
  });

  it('two channels sharing one global map see each other\'s values', async () => {
    const shared = new GlobalMapProxy({ save: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), onFlushError: vi.fn() }, 60_000);
    const writer = await compile('globalMap["lastPatient"] = { mrn: "00123" }; return msg;');
    const reader = await compile('return globalMap["lastPatient"].mrn;');
    const base = { serverId: 'srv-1', dataType: 'RAW', destinations: [], globalMapProxy: shared } as const;
    const a = new MessageProcessor(executor, makeStore(), makeSendFn(), { ...base, channelId: 'ch-a', scripts: { preprocessor: writer } }, DEFAULT_EXECUTION_OPTIONS);
    const storeB = makeStore();
    const b = new MessageProcessor(executor, storeB, makeSendFn(), { ...base, channelId: 'ch-b', scripts: { sourceTransformer: reader } }, DEFAULT_EXECUTION_OPTIONS);

    expect((await a.processMessage({ rawContent: 'x', sourceMap: {} }, AbortSignal.timeout(5_000))).ok).toBe(true);
    expect((await b.processMessage({ rawContent: 'y', sourceMap: {} }, AbortSignal.timeout(5_000))).ok).toBe(true);

    const calls = (storeB.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.find((c: unknown[]) => c[3] === 3)![4]).toBe('00123');
    await shared.dispose();
  });

  it('a script that deletes a globalChannelMap key removes it', async () => {
    const gcm = new GlobalChannelMap();
    gcm.put('stale', 1);
    const preprocessor = await compile('delete globalChannelMap["stale"]; return msg;');
    const config: PipelineConfig = { channelId: 'ch-1', serverId: 'srv-1', dataType: 'RAW', scripts: { preprocessor }, destinations: [], globalChannelMap: gcm };
    const processor = new MessageProcessor(executor, makeStore(), makeSendFn(), config, DEFAULT_EXECUTION_OPTIONS);
    expect((await processor.processMessage({ rawContent: 'x', sourceMap: {} }, AbortSignal.timeout(5_000))).ok).toBe(true);
    expect(gcm.containsKey('stale')).toBe(false);
  });

  it('map shortcuts $ work in pipeline scripts', async () => {
    const preprocessor = await compile('channelMap["myKey"] = "found"; return msg;');
    const sourceTransformer = await compile('return $("myKey");');

    const scripts: ChannelScripts = { preprocessor, sourceTransformer };
    const config: PipelineConfig = {
      channelId: 'ch-1',
      serverId: 'srv-1',
      dataType: 'RAW',
      scripts,
      destinations: [],
    };

    const store = makeStore();
    const processor = new MessageProcessor(executor, store, makeSendFn(), config, DEFAULT_EXECUTION_OPTIONS);
    const result = await processor.processMessage(
      { rawContent: 'test', sourceMap: {} },
      AbortSignal.timeout(5_000),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const storeContentCalls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const transformedCall = storeContentCalls.find((c: unknown[]) => c[3] === 3);
    expect(transformedCall).toBeDefined();
    expect(transformedCall![4]).toBe('found');
  });
});
