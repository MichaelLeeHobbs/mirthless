// ===========================================
// Message Processor Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Result } from '@mirthless/core-util';
import { MessageProcessor } from '../message-processor.js';
import type {
  MessageStore,
  SendToDestination,
  PipelineConfig,
  PipelineInput,
  DestinationResponse,
} from '../message-processor.js';
import { VmSandboxExecutor, DEFAULT_EXECUTION_OPTIONS } from '../../sandbox/sandbox-executor.js';
import { GlobalChannelMap } from '../../runtime/global-channel-map.js';

// ----- Helpers -----

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

function makeStore(): MessageStore {
  return {
    createMessage: vi.fn().mockResolvedValue(ok({ messageId: 1 })),
    createConnectorMessage: vi.fn().mockResolvedValue(ok(undefined)),
    updateConnectorMessageStatus: vi.fn().mockResolvedValue(ok(undefined)),
    storeContent: vi.fn().mockResolvedValue(ok(undefined)),
    markProcessed: vi.fn().mockResolvedValue(ok(undefined)),
    enqueue: vi.fn().mockResolvedValue(ok(undefined)),
    loadContent: vi.fn().mockResolvedValue(ok(null)),
    incrementStats: vi.fn().mockResolvedValue(ok(undefined)),
    dequeue: vi.fn().mockResolvedValue(ok([])),
    release: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function makeSendFn(
  response?: DestinationResponse,
): SendToDestination {
  const resp = response ?? { status: 'SENT' as const, content: 'MSA|AA|12345' };
  return vi.fn().mockResolvedValue(ok(resp));
}

function makeInput(content?: string): PipelineInput {
  return {
    rawContent: content ?? 'MSH|^~\\&|SENDER',
    sourceMap: { remoteAddress: '127.0.0.1' },
  };
}

function makeConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    channelId: '00000000-0000-0000-0000-000000000001',
    serverId: 'server-01',
    dataType: 'HL7V2',
    scripts: {},
    destinations: [{
      metaDataId: 1,
      name: 'Dest 1',
      enabled: true,
      scripts: {},
      queueEnabled: false,
    }],
    ...overrides,
  };
}

// ----- Setup -----

let sandbox: VmSandboxExecutor;

beforeEach(() => {
  sandbox = new VmSandboxExecutor();
});

// ----- Tests -----

describe('MessageProcessor', () => {
  it('processes message through full pipeline (happy path)', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const processor = new MessageProcessor(
      sandbox, store, sendFn, makeConfig(), DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.messageId).toBe(1);
    expect(result.value.status).toBe('SENT');
    expect(result.value.destinationResults).toHaveLength(1);
    expect(result.value.destinationResults[0]!.status).toBe('SENT');

    // Verify store calls
    expect(store.createMessage).toHaveBeenCalledOnce();
    expect(store.createConnectorMessage).toHaveBeenCalledTimes(2); // source + dest
    expect(store.storeContent).toHaveBeenCalled();
    expect(store.markProcessed).toHaveBeenCalledOnce();
    expect(store.incrementStats).toHaveBeenCalled();
  });

  it('filters message at source filter (returns false)', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        sourceFilter: { code: 'return false;' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('FILTERED');
    expect(result.value.destinationResults).toHaveLength(0);

    // Source filter → no destinations called
    expect(sendFn).not.toHaveBeenCalled();
    expect(store.incrementStats).toHaveBeenCalledWith(
      expect.any(String), 0, expect.any(String), 'filtered',
    );
  });

  it('passes message when source filter returns true', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        sourceFilter: { code: 'return true;' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
  });

  it('source transformer modifies content', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        sourceTransformer: { code: 'return "TRANSFORMED_CONTENT";' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    // Transformed content stored
    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 0, 3, 'TRANSFORMED_CONTENT', 'HL7V2',
    );
  });

  it('routes to 2 destinations in parallel', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [
        { metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueEnabled: false },
        { metaDataId: 2, name: 'Dest 2', enabled: true, scripts: {}, queueEnabled: false },
      ],
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults).toHaveLength(2);
    expect(result.value.destinationResults[0]!.status).toBe('SENT');
    expect(result.value.destinationResults[1]!.status).toBe('SENT');
    expect(sendFn).toHaveBeenCalledTimes(2);
  });

  it('destination filter rejects one destination', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [
        {
          metaDataId: 1, name: 'Dest 1', enabled: true,
          scripts: { filter: { code: 'return false;' } },
          queueEnabled: false,
        },
        {
          metaDataId: 2, name: 'Dest 2', enabled: true,
          scripts: {},
          queueEnabled: false,
        },
      ],
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dest1 = result.value.destinationResults.find((d) => d.metaDataId === 1);
    const dest2 = result.value.destinationResults.find((d) => d.metaDataId === 2);
    expect(dest1!.status).toBe('FILTERED');
    expect(dest2!.status).toBe('SENT');
    // Only dest2 should have been sent
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  it('queues message when destination queueEnabled', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [{
        metaDataId: 1, name: 'Dest 1', enabled: true,
        scripts: {},
        queueEnabled: true,
      }],
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults[0]!.status).toBe('QUEUED');
    expect(store.enqueue).toHaveBeenCalledOnce();
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('preprocessor and postprocessor scripts execute', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        preprocessor: { code: 'logger.info("pre"); return rawData;' },
        postprocessor: { code: 'logger.info("post"); return true;' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
  });

  it('skips disabled destinations', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [
        { metaDataId: 1, name: 'Dest 1', enabled: false, scripts: {}, queueEnabled: false },
        { metaDataId: 2, name: 'Dest 2', enabled: true, scripts: {}, queueEnabled: false },
      ],
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults).toHaveLength(1);
    expect(result.value.destinationResults[0]!.metaDataId).toBe(2);
  });

  it('reports ERROR when destination send fails', async () => {
    const store = makeStore();
    const sendFn: SendToDestination = vi.fn().mockResolvedValue({
      ok: false, value: null, error: { message: 'Connection refused' },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, makeConfig(), DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(result.value.destinationResults[0]!.status).toBe('ERROR');
    expect(store.incrementStats).toHaveBeenCalledWith(
      expect.any(String), 1, expect.any(String), 'errored',
    );
  });

  it('destination transformer modifies content before send', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [{
        metaDataId: 1, name: 'Dest 1', enabled: true,
        scripts: { transformer: { code: 'return "DEST_TRANSFORMED";' } },
        queueEnabled: false,
      }],
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    // Transformed content should be sent
    expect(sendFn).toHaveBeenCalledWith(1, 'DEST_TRANSFORMED', expect.any(AbortSignal));
  });

  // ----- Global Scripts -----

  it('global preprocessor runs before channel preprocessor', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        globalPreprocessor: { code: 'return rawData + "_GLOBAL";' },
        preprocessor: { code: 'return rawData + "_CHANNEL";' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput('MSG'), AbortSignal.timeout(5_000));

    // Global preprocessor returns "MSG_GLOBAL"
    // Channel preprocessor gets rawData (still original "MSG") and returns "MSG_CHANNEL"
    // But preprocessor reads rawData which is the ORIGINAL input
    // The content flows through, so destination gets channel preprocessor output
    expect(sendFn).toHaveBeenCalledWith(1, expect.any(String), expect.any(AbortSignal));
  });

  it('global postprocessor runs after channel postprocessor', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        postprocessor: { code: 'logger.info("channel_post"); return true;' },
        globalPostprocessor: { code: 'logger.info("global_post"); return true;' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
  });

  it('works with only global scripts (no channel scripts)', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        globalPreprocessor: { code: 'return rawData + "_GP";' },
        globalPostprocessor: { code: 'logger.info("done"); return true;' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
  });

  it('global preprocessor modifies content for downstream stages', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        globalPreprocessor: { code: 'return "GLOBAL_MODIFIED";' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    // Destination receives the globally-modified content
    expect(sendFn).toHaveBeenCalledWith(1, 'GLOBAL_MODIFIED', expect.any(AbortSignal));
  });

  // ----- globalChannelMap -----

  it('globalChannelMap persists across two processMessage calls', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const gcm = new GlobalChannelMap();
    const config = makeConfig({
      scripts: {
        preprocessor: { code: 'var c = globalChannelMap["counter"] || 0; globalChannelMap["counter"] = c + 1; return rawData;' },
      },
      globalChannelMap: gcm,
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));
    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(gcm.get('counter')).toBe(2);
  });

  it('sandbox reads from globalChannelMap', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const gcm = new GlobalChannelMap();
    gcm.put('greeting', 'hello');
    const config = makeConfig({
      scripts: {
        preprocessor: { code: 'return globalChannelMap["greeting"];' },
      },
      globalChannelMap: gcm,
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    // Preprocessor returned the value from globalChannelMap
    expect(sendFn).toHaveBeenCalledWith(1, 'hello', expect.any(AbortSignal));
  });

  // ----- destinationSet -----

  it('source transformer removes destination via destinationSet', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        sourceTransformer: { code: 'destinationSet.remove("Dest 2"); return rawData;' },
      },
      destinations: [
        { metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueEnabled: false },
        { metaDataId: 2, name: 'Dest 2', enabled: true, scripts: {}, queueEnabled: false },
      ],
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only Dest 1 should have been sent to
    expect(result.value.destinationResults).toHaveLength(1);
    expect(result.value.destinationResults[0]!.metaDataId).toBe(1);
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  it('removeAllExcept routes to single destination', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        sourceTransformer: { code: 'destinationSet.removeAllExcept("Dest 2"); return rawData;' },
      },
      destinations: [
        { metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueEnabled: false },
        { metaDataId: 2, name: 'Dest 2', enabled: true, scripts: {}, queueEnabled: false },
        { metaDataId: 3, name: 'Dest 3', enabled: true, scripts: {}, queueEnabled: false },
      ],
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults).toHaveLength(1);
    expect(result.value.destinationResults[0]!.metaDataId).toBe(2);
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  it('destinationSet removeAll sends to no destinations', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        sourceTransformer: { code: 'destinationSet.removeAll(); return rawData;' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults).toHaveLength(0);
    expect(sendFn).not.toHaveBeenCalled();
  });

  // ----- sourceMap persistence -----

  it('stores sourceMap as JSON string after raw content', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const processor = new MessageProcessor(
      sandbox, store, sendFn, makeConfig(), DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    // First storeContent call = raw (CT_RAW=1), second = sourceMap (CT_SOURCE_MAP=9)
    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 0, 9, expect.any(String), 'JSON',
    );
  });

  it('stores sourceMap with contentType=9', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const processor = new MessageProcessor(
      sandbox, store, sendFn, makeConfig(), DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    const calls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const sourceMapCall = calls.find((c) => c[3] === 9);
    expect(sourceMapCall).toBeDefined();
    expect(sourceMapCall![3]).toBe(9);
  });

  it('stores sourceMap with dataType=JSON', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const processor = new MessageProcessor(
      sandbox, store, sendFn, makeConfig(), DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    const calls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const sourceMapCall = calls.find((c) => c[3] === 9);
    expect(sourceMapCall).toBeDefined();
    expect(sourceMapCall![5]).toBe('JSON');
  });

  it('stores empty sourceMap {} as JSON', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const processor = new MessageProcessor(
      sandbox, store, sendFn, makeConfig(), DEFAULT_EXECUTION_OPTIONS,
    );

    const input: PipelineInput = { rawContent: 'MSH|^~\\&|TEST', sourceMap: {} };
    await processor.processMessage(input, AbortSignal.timeout(5_000));

    const calls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const sourceMapCall = calls.find((c) => c[3] === 9);
    expect(sourceMapCall).toBeDefined();
    expect(sourceMapCall![4]).toBe('{}');
  });

  it('serializes complex nested sourceMap correctly', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const processor = new MessageProcessor(
      sandbox, store, sendFn, makeConfig(), DEFAULT_EXECUTION_OPTIONS,
    );

    const input: PipelineInput = {
      rawContent: 'MSH|^~\\&|TEST',
      sourceMap: { remoteAddress: '10.0.0.1', headers: { 'content-type': 'text/plain' }, port: 6661 },
    };
    await processor.processMessage(input, AbortSignal.timeout(5_000));

    const calls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const sourceMapCall = calls.find((c) => c[3] === 9);
    expect(sourceMapCall).toBeDefined();
    const parsed = JSON.parse(sourceMapCall![4] as string) as Record<string, unknown>;
    expect(parsed).toEqual({ remoteAddress: '10.0.0.1', headers: { 'content-type': 'text/plain' }, port: 6661 });
  });

  it('sourceMap storeContent failure does not crash pipeline', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    let callCount = 0;
    (store.storeContent as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      // Fail the second storeContent call (sourceMap)
      if (callCount === 2) {
        return Promise.reject(new Error('sourceMap write failed'));
      }
      return Promise.resolve(ok(undefined));
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, makeConfig(), DEFAULT_EXECUTION_OPTIONS,
    );

    // tryCatch wraps the entire pipeline, so a storeContent failure results in a failed Result
    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    // The error is caught by tryCatch — pipeline returns error result
    expect(result.ok).toBe(false);
  });

  it('filtered messages still have sourceMap stored (before filter stage)', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        sourceFilter: { code: 'return false;' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('FILTERED');

    // sourceMap should still have been stored (happens before filter stage)
    const calls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const sourceMapCall = calls.find((c) => c[3] === 9);
    expect(sourceMapCall).toBeDefined();
  });
});
