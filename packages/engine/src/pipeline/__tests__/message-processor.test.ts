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
});
