// ===========================================
// Response Transformer Tests
// ===========================================
// Tests for the response transformer pipeline stage.

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
// ----- Helpers -----

function makeScript(code: string): CompiledScript {
  return { code };
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

function makeStore(): MessageStore {
  return {
    createMessage: vi.fn().mockResolvedValue(ok({ messageId: 1, correlationId: '00000000-0000-0000-0000-000000000099' })),
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

function makeSendFn(response?: DestinationResponse): SendToDestination {
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

describe('Response Transformer', () => {
  it('stores response as-is when no response transformer configured', async () => {
    const store = makeStore();
    const sendFn = makeSendFn({ status: 'SENT', content: 'original response' });
    const config = makeConfig();
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), new AbortController().signal);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults[0]!.response).toBe('original response');
    // CT_RESPONSE=6 should be stored, CT_RESPONSE_TRANSFORMED=7 should NOT
    const storeContentCalls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const responseStores = storeContentCalls.filter((c: unknown[]) => c[3] === 6);
    const transformedStores = storeContentCalls.filter((c: unknown[]) => c[3] === 7);
    expect(responseStores).toHaveLength(1);
    expect(transformedStores).toHaveLength(0);
  });

  it('runs response transformer and stores CT_RESPONSE_TRANSFORMED', async () => {
    const store = makeStore();
    const sendFn = makeSendFn({ status: 'SENT', content: 'original response' });
    const responseTransformerScript = makeScript('return "transformed: " + msg;');
    const config = makeConfig({
      destinations: [{
        metaDataId: 1,
        name: 'Dest 1',
        enabled: true,
        scripts: { responseTransformer: responseTransformerScript },
        queueEnabled: false,
      }],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), new AbortController().signal);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults[0]!.response).toBe('transformed: original response');
    // Both CT_RESPONSE=6 and CT_RESPONSE_TRANSFORMED=7 should be stored
    const storeContentCalls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const responseStores = storeContentCalls.filter((c: unknown[]) => c[3] === 6);
    const transformedStores = storeContentCalls.filter((c: unknown[]) => c[3] === 7);
    expect(responseStores).toHaveLength(1);
    expect(transformedStores).toHaveLength(1);
    expect(transformedStores[0]![4]).toBe('transformed: original response');
  });

  it('uses original response when transformer returns non-string', async () => {
    const store = makeStore();
    const sendFn = makeSendFn({ status: 'SENT', content: 'original' });
    const responseTransformerScript = makeScript('return 42;');
    const config = makeConfig({
      destinations: [{
        metaDataId: 1,
        name: 'Dest 1',
        enabled: true,
        scripts: { responseTransformer: responseTransformerScript },
        queueEnabled: false,
      }],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), new AbortController().signal);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults[0]!.response).toBe('original');
  });

  it('does not run response transformer on ERROR status', async () => {
    const store = makeStore();
    const sendFn = makeSendFn({ status: 'ERROR', content: 'error response', errorMessage: 'fail' });
    const responseTransformerScript = makeScript('return "should not run";');
    const config = makeConfig({
      destinations: [{
        metaDataId: 1,
        name: 'Dest 1',
        enabled: true,
        scripts: { responseTransformer: responseTransformerScript },
        queueEnabled: false,
      }],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), new AbortController().signal);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults[0]!.status).toBe('ERROR');
    const storeContentCalls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const transformedStores = storeContentCalls.filter((c: unknown[]) => c[3] === 7);
    expect(transformedStores).toHaveLength(0);
  });

  it('does not run response transformer on queued destinations', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const responseTransformerScript = makeScript('return "should not run";');
    const config = makeConfig({
      destinations: [{
        metaDataId: 1,
        name: 'Dest 1',
        enabled: true,
        scripts: { responseTransformer: responseTransformerScript },
        queueEnabled: true,
      }],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), new AbortController().signal);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults[0]!.status).toBe('QUEUED');
    const storeContentCalls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const transformedStores = storeContentCalls.filter((c: unknown[]) => c[3] === 7);
    expect(transformedStores).toHaveLength(0);
  });

  it('transforms response content independently per destination', async () => {
    const store = makeStore();
    const responses: DestinationResponse[] = [
      { status: 'SENT', content: 'resp-A' },
      { status: 'SENT', content: 'resp-B' },
    ];
    let callCount = 0;
    const sendFn: SendToDestination = vi.fn().mockImplementation(() => {
      const resp = responses[callCount]!;
      callCount++;
      return Promise.resolve(ok(resp));
    });
    const rtScript = makeScript('return "TX:" + msg;');
    const config = makeConfig({
      destinations: [
        { metaDataId: 1, name: 'D1', enabled: true, scripts: { responseTransformer: rtScript }, queueEnabled: false },
        { metaDataId: 2, name: 'D2', enabled: true, scripts: { responseTransformer: rtScript }, queueEnabled: false },
      ],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), new AbortController().signal);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults).toHaveLength(2);
    expect(result.value.destinationResults[0]!.response).toBe('TX:resp-A');
    expect(result.value.destinationResults[1]!.response).toBe('TX:resp-B');
  });

  it('response transformer receives response content as msg', async () => {
    const store = makeStore();
    const sendFn = makeSendFn({ status: 'SENT', content: 'the-response' });
    // Script that returns msg (which should be the response content)
    const rtScript = makeScript('return msg;');
    const config = makeConfig({
      destinations: [{
        metaDataId: 1,
        name: 'Dest 1',
        enabled: true,
        scripts: { responseTransformer: rtScript },
        queueEnabled: false,
      }],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), new AbortController().signal);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults[0]!.response).toBe('the-response');
  });

  it('handles response transformer execution failure gracefully', async () => {
    const store = makeStore();
    const sendFn = makeSendFn({ status: 'SENT', content: 'original' });
    // Script that throws
    const rtScript = makeScript('throw new Error("transform failed");');
    const config = makeConfig({
      destinations: [{
        metaDataId: 1,
        name: 'Dest 1',
        enabled: true,
        scripts: { responseTransformer: rtScript },
        queueEnabled: false,
      }],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), new AbortController().signal);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Falls back to original response content
    expect(result.value.destinationResults[0]!.response).toBe('original');
  });

  it('stores CT_RESPONSE_TRANSFORMED with correct metaDataId', async () => {
    const store = makeStore();
    const sendFn = makeSendFn({ status: 'SENT', content: 'resp' });
    const rtScript = makeScript('return "tx-resp";');
    const config = makeConfig({
      destinations: [{
        metaDataId: 3,
        name: 'Dest 3',
        enabled: true,
        scripts: { responseTransformer: rtScript },
        queueEnabled: false,
      }],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage(makeInput(), new AbortController().signal);

    const storeContentCalls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const txStore = storeContentCalls.find((c: unknown[]) => c[3] === 7);
    expect(txStore).toBeDefined();
    // metaDataId should be 3
    expect(txStore![2]).toBe(3);
  });
});
