// Deploy and undeploy scripts are not tested here: the engine has no path for
// them. The server runs them (`packages/server/src/engine.ts`, runDeployScript).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Result } from '@galvanigraph/core-util';
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
    removeCompletedContent: vi.fn().mockResolvedValue(ok(undefined)),
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
    dataType: 'RAW',
    scripts: {},
    destinations: [{
      metaDataId: 1,
      name: 'Dest 1',
      enabled: true,
      scripts: {},
      queueMode: 'NEVER',
    }],
    ...overrides,
  };
}

let sandbox: VmSandboxExecutor;

beforeEach(() => {
  sandbox = new VmSandboxExecutor();
});

describe('channel preprocessor', () => {
  it('happy path: a returned string replaces the message for all downstream stages', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: { preprocessor: { code: 'return "PREPROCESSED_MSG";' } },
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput('ORIGINAL_MSG'), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
    expect(sendFn).toHaveBeenCalledWith(1, 1, 'PREPROCESSED_MSG', expect.any(AbortSignal), expect.any(String), undefined);
  });

  it('a mutated `msg` (no explicit return) replaces the message', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: { preprocessor: { code: 'msg = "MUTATED_VIA_MSG";' } },
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage(makeInput('ORIGINAL_MSG'), AbortSignal.timeout(5_000));

    expect(sendFn).toHaveBeenCalledWith(1, 1, 'MUTATED_VIA_MSG', expect.any(AbortSignal), expect.any(String), undefined);
  });

  it('regression: `return true` does NOT corrupt the message to the string "true"', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: { preprocessor: { code: 'return true;' } },
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage(makeInput('ORIGINAL_MSG'), AbortSignal.timeout(5_000));

    // A boolean return is treated as "leave the message unchanged".
    expect(sendFn).toHaveBeenCalledWith(1, 1, 'ORIGINAL_MSG', expect.any(AbortSignal), expect.any(String), undefined);
  });

  it('regression: `return false` also leaves the message intact (not the string "false")', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: { preprocessor: { code: 'return false;' } },
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput('ORIGINAL_MSG'), AbortSignal.timeout(5_000));

    // The preprocessor is not a filter — `false` must not drop or corrupt the message.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
    expect(sendFn).toHaveBeenCalledWith(1, 1, 'ORIGINAL_MSG', expect.any(AbortSignal), expect.any(String), undefined);
  });

  it('an explicit `return undefined` leaves the message intact', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: { preprocessor: { code: 'return undefined;' } },
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage(makeInput('ORIGINAL_MSG'), AbortSignal.timeout(5_000));

    expect(sendFn).toHaveBeenCalledWith(1, 1, 'ORIGINAL_MSG', expect.any(AbortSignal), expect.any(String), undefined);
  });

  it('no return statement at all leaves the message intact', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: { preprocessor: { code: 'var x = 1 + 1;' } },
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage(makeInput('ORIGINAL_MSG'), AbortSignal.timeout(5_000));

    expect(sendFn).toHaveBeenCalledWith(1, 1, 'ORIGINAL_MSG', expect.any(AbortSignal), expect.any(String), undefined);
  });

  it('a throwing preprocessor surfaces as ERROR, stores error content, and does not send', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const onError = vi.fn().mockResolvedValue(undefined);
    const config = makeConfig({
      scripts: { preprocessor: { code: 'throw new Error("pre boom");' } },
      onError,
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(result.value.destinationResults).toHaveLength(0);
    // Source connector (metaDataId 0) error content (CONTENT_TYPE.PROCESSING_ERROR = 13).
    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 0, 13, expect.stringContaining('pre boom'), 'TEXT',
    );
    expect(store.incrementStats).toHaveBeenCalledWith(expect.any(String), 0, expect.any(String), 'errored');
    expect(sendFn).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });

  it('runs before the source filter (its replacement is what the filter sees)', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        preprocessor: { code: 'return "PASSPHRASE";' },
        sourceFilter: { code: 'return msg === "PASSPHRASE";' },
      },
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput('ORIGINAL_MSG'), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
    expect(sendFn).toHaveBeenCalledWith(1, 1, 'PASSPHRASE', expect.any(AbortSignal), expect.any(String), undefined);
  });
});

describe('channel postprocessor', () => {
  it('happy path: runs after routing and can read the destination response via responseMap', async () => {
    const store = makeStore();
    const sendFn = makeSendFn({ status: 'SENT', content: 'MSA|AA|OK99' });
    const gcm = new GlobalChannelMap();
    const config = makeConfig({
      scripts: {
        postprocessor: { code: 'globalChannelMap["capturedResponse"] = responseMap["Dest 1"].content; return true;' },
      },
      globalChannelMap: gcm,
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
    expect(gcm.get('capturedResponse')).toBe('MSA|AA|OK99');
  });

  it('can read the (possibly transformed) message content', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const gcm = new GlobalChannelMap();
    const config = makeConfig({
      scripts: {
        postprocessor: { code: 'globalChannelMap["seenMsg"] = msg; return true;' },
      },
      globalChannelMap: gcm,
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage(makeInput('POST_INPUT'), AbortSignal.timeout(5_000));

    expect(gcm.get('seenMsg')).toBe('POST_INPUT');
  });

  it('a throwing postprocessor surfaces as ERROR, stores error content, and alerts (not silently swallowed)', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const onError = vi.fn().mockResolvedValue(undefined);
    const config = makeConfig({
      scripts: { postprocessor: { code: 'throw new Error("post boom");' } },
      onError,
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(result.value.destinationResults[0]!.status).toBe('SENT');
    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 0, 13, expect.stringContaining('post boom'), 'TEXT',
    );
    // Source counted errored (never SENT) so throughput stats stay truthful.
    expect(store.incrementStats).toHaveBeenCalledWith(expect.any(String), 0, expect.any(String), 'errored');
    expect(store.incrementStats).not.toHaveBeenCalledWith(expect.any(String), 0, expect.any(String), 'sent');
    expect(onError).toHaveBeenCalled();
  });

  it('a postprocessor return value does not replace the outbound message content', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: { postprocessor: { code: 'return "IGNORED_RETURN";' } },
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput('ORIGINAL_MSG'), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
    expect(sendFn).toHaveBeenCalledWith(1, 1, 'ORIGINAL_MSG', expect.any(AbortSignal), expect.any(String), undefined);
  });
});

describe('response to the sender', () => {
  const twoDestinations: PipelineConfig['destinations'] = [
    { metaDataId: 1, name: 'First', enabled: true, scripts: {}, queueMode: 'NEVER' },
    { metaDataId: 2, name: 'Second', enabled: true, scripts: {}, queueMode: 'NEVER' },
  ];
  const sendByDest: SendToDestination = vi.fn(async (metaDataId) => ok({ status: 'SENT' as const, content: `reply from ${String(metaDataId)}` }));

  async function respond(overrides: Partial<PipelineConfig>): Promise<string | undefined> {
    const processor = new MessageProcessor(sandbox, makeStore(), sendByDest, makeConfig({ destinations: twoDestinations, ...overrides }), DEFAULT_EXECUTION_OPTIONS);
    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));
    if (!result.ok) throw result.error;
    return result.value.response;
  }

  it('is what the postprocessor returns when the channel responds from the postprocessor', async () => {
    const response = await respond({
      responseSource: { kind: 'POSTPROCESSOR' },
      scripts: { postprocessor: { code: 'channelMap["ack"] = "ACK built"; return channelMap["ack"];' } },
    });
    expect(response).toBe('ACK built');
  });

  it('is JSON when the postprocessor returns an object', async () => {
    const response = await respond({
      responseSource: { kind: 'POSTPROCESSOR' },
      scripts: { postprocessor: { code: 'return { status: "ok", count: 2 };' } },
    });
    expect(JSON.parse(response ?? '')).toEqual({ status: 'ok', count: 2 });
  });

  it('is absent when the postprocessor returns nothing, so the source falls back to its own ACK', async () => {
    const response = await respond({
      responseSource: { kind: 'POSTPROCESSOR' },
      scripts: { postprocessor: { code: 'channelMap["x"] = 1;' } },
    });
    expect(response).toBeUndefined();
  });

  it('is the named destination\'s response when the channel responds from a destination', async () => {
    const response = await respond({ responseSource: { kind: 'DESTINATION', destinationName: 'Second' } });
    expect(response).toBe('reply from 2');
  });

  it('is the first destination\'s response by default', async () => {
    const response = await respond({});
    expect(response).toBe('reply from 1');
  });
});
