import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Result } from '@galvanigraph/core-util';
import { delimitedOptionsSchema } from '@galvanigraph/core-models';
import { MessageProcessor, groupDestinationChains } from '../message-processor.js';
import type {
  MessageStore,
  SendToDestination,
  PipelineConfig,
  PipelineInput,
  DestinationResponse,
  DestinationConfig,
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

    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 0, 3, 'TRANSFORMED_CONTENT', 'RAW',
    );
  });

  it('source transformer modifies content via msg assignment (no return)', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        sourceTransformer: { code: 'msg = "test";' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput('original'), AbortSignal.timeout(5_000));

    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 0, 3, 'test', 'RAW',
    );
    expect(sendFn).toHaveBeenCalledWith(1, 1,'test', expect.any(AbortSignal), expect.any(String), undefined);
  });

  it('destination transformer modifies content via msg assignment (no return)', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [{
        metaDataId: 1, name: 'Dest 1', enabled: true,
        scripts: { transformer: { code: 'msg = "dest_modified";' } },
        queueMode: 'NEVER',
      }],
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput('original'), AbortSignal.timeout(5_000));

    expect(sendFn).toHaveBeenCalledWith(1, 1,'dest_modified', expect.any(AbortSignal), expect.any(String), undefined);
  });

  it('routes to 2 destinations in parallel', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [
        { metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'NEVER' },
        { metaDataId: 2, name: 'Dest 2', enabled: true, scripts: {}, queueMode: 'NEVER' },
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

  function makeOrderedSendFn(events: string[]): SendToDestination {
    return vi.fn(async (metaDataId: number) => {
      events.push(`start ${String(metaDataId)}`);
      await new Promise((r) => setTimeout(r, 10));
      events.push(`end ${String(metaDataId)}`);
      return ok({ status: 'SENT' as const, content: `ACK${String(metaDataId)}` });
    });
  }

  it('runs a waitForPrevious destination only after the one before it finishes', async () => {
    const events: string[] = [];
    const config = makeConfig({
      destinations: [
        { metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'NEVER' },
        { metaDataId: 2, name: 'Dest 2', enabled: true, scripts: {}, queueMode: 'NEVER', waitForPrevious: true },
      ],
    });
    const processor = new MessageProcessor(
      sandbox, makeStore(), makeOrderedSendFn(events), config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    expect(events).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });

  it('starts destinations without waitForPrevious in parallel', async () => {
    const events: string[] = [];
    const config = makeConfig({
      destinations: [
        { metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'NEVER' },
        { metaDataId: 2, name: 'Dest 2', enabled: true, scripts: {}, queueMode: 'NEVER', waitForPrevious: false },
      ],
    });
    const processor = new MessageProcessor(
      sandbox, makeStore(), makeOrderedSendFn(events), config, DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(events.slice(0, 2)).toEqual(['start 1', 'start 2']);
  });

  it('lets a waitForPrevious destination read the earlier response from responseMap', async () => {
    const sendFn = vi.fn(async (metaDataId: number) =>
      ok({ status: 'SENT' as const, content: `ACK${String(metaDataId)}` }));
    const config = makeConfig({
      destinations: [
        { metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'NEVER' },
        {
          metaDataId: 2, name: 'Dest 2', enabled: true, queueMode: 'NEVER', waitForPrevious: true,
          scripts: { transformer: { code: 'msg = responseMap["Dest 1"].content;' } },
        },
      ],
    });
    const processor = new MessageProcessor(
      sandbox, makeStore(), sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(sendFn).toHaveBeenCalledWith(2, 1, 'ACK1', expect.any(AbortSignal), expect.any(String), { 'Dest 1': { status: 'SENT', content: 'ACK1' } });
  });

  it('keeps destination results in configured order across chains', async () => {
    const events: string[] = [];
    const config = makeConfig({
      destinations: [
        { metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'NEVER' },
        { metaDataId: 2, name: 'Dest 2', enabled: true, scripts: {}, queueMode: 'NEVER', waitForPrevious: true },
        { metaDataId: 3, name: 'Dest 3', enabled: true, scripts: {}, queueMode: 'NEVER' },
      ],
    });
    const processor = new MessageProcessor(
      sandbox, makeStore(), makeOrderedSendFn(events), config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults.map((r) => r.metaDataId)).toEqual([1, 2, 3]);
  });

  it('HL7V2 channel: msg is auto-parsed, transformer accesses fields directly', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const hl7 = [
      'MSH|^~\\&|SEND|FAC|RECV|FAC|20260329||ADT^A01|CTL001|P|2.5',
      'PID|||12345^^^MRN||DOE^JOHN||19800101|M',
    ].join('\r');
    const config = makeConfig({
      dataType: 'HL7V2',
      scripts: {
        sourceTransformer: { code: 'return msg.get("PID.3");' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(
      { rawContent: hl7, sourceMap: {} }, AbortSignal.timeout(5_000),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 0, 3, '12345', 'HL7V2',
    );
  });

  it('JSON channel: msg is auto-parsed, transformer accesses properties', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      dataType: 'JSON',
      scripts: {
        sourceTransformer: { code: 'return msg.patient.name;' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(
      { rawContent: '{"patient":{"name":"John Doe"}}', sourceMap: {} },
      AbortSignal.timeout(5_000),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 0, 3, 'John Doe', 'JSON',
    );
  });

  it('invalid JSON errors the message', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({ dataType: 'JSON' });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(
      { rawContent: 'not valid json {{{', sourceMap: {} },
      AbortSignal.timeout(5_000),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    // Error stored as processing error
    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 0, 13, expect.stringContaining('Invalid JSON'), 'TEXT',
    );
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('invalid HL7V2 errors the message', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({ dataType: 'HL7V2' });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(
      { rawContent: 'not valid hl7', sourceMap: {} },
      AbortSignal.timeout(5_000),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 0, 13, expect.stringContaining('Invalid HL7V2'), 'TEXT',
    );
  });

  it('parseHL7(msg) on already-parsed HL7V2 msg is a no-op', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const hl7 = 'MSH|^~\\&|S|F|R|F|20260329||ADT^A01|C1|P|2.5\rPID|||99999^^^MRN';
    const config = makeConfig({
      dataType: 'HL7V2',
      scripts: {
        sourceTransformer: { code: 'var parsed = parseHL7(msg); return parsed.get("PID.3");' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(
      { rawContent: hl7, sourceMap: {} }, AbortSignal.timeout(5_000),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('SENT');
    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 0, 3, '99999', 'HL7V2',
    );
  });

  it('destination filter rejects one destination', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [
        {
          metaDataId: 1, name: 'Dest 1', enabled: true,
          scripts: { filter: { code: 'return false;' } },
          queueMode: 'NEVER',
        },
        {
          metaDataId: 2, name: 'Dest 2', enabled: true,
          scripts: {},
          queueMode: 'NEVER',
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
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  it('queues message when destination queueEnabled', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [{
        metaDataId: 1, name: 'Dest 1', enabled: true,
        scripts: {},
        queueMode: 'ALWAYS',
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

  it('errors the destination (never QUEUED) when enqueue fails — no silent loss', async () => {
    const store = makeStore();
    (store.enqueue as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, value: null, error: new Error('db down'),
    });
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [{ metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'ALWAYS' }],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults[0]!.status).toBe('ERROR');
    expect(store.incrementStats).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 1, 'server-01', 'errored');
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('ON_FAILURE: attempts a direct send first, then queues on failure (not ERROR)', async () => {
    const store = makeStore();
    const sendFn = vi.fn().mockResolvedValue({ ok: false, value: null, error: new Error('conn refused') }) as SendToDestination;
    const config = makeConfig({
      destinations: [{ metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'ON_FAILURE' }],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sendFn).toHaveBeenCalledOnce();
    expect(result.value.destinationResults[0]!.status).toBe('QUEUED');
    expect(store.enqueue).toHaveBeenCalledOnce();
    expect(store.incrementStats).not.toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 1, 'server-01', 'errored');
  });

  it('stores what a destination answered as text, not as the inbound data type', async () => {
    const store = makeStore();
    const processor = new MessageProcessor(sandbox, store, makeSendFn(), makeConfig({ dataType: 'HL7V2' }), DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage(makeInput('MSH|^~\\&|A|B|C|D|20260101||ADT^A01|1|P|2.5'), AbortSignal.timeout(5_000));

    const responses = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls.filter((c: unknown[]) => c[3] === 6);
    expect(responses).toHaveLength(1);
    expect(responses[0]![5]).toBe('TEXT');
  });

  it('runs removeCompletedContent on full success', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const processor = new MessageProcessor(sandbox, store, sendFn, makeConfig(), DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(store.removeCompletedContent).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 1);
  });

  it('does NOT run removeCompletedContent when a destination is still queued', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [{ metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'ALWAYS' }],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    // Queued destination still needs the stored content — cleanup must not run.
    expect(store.removeCompletedContent).not.toHaveBeenCalled();
  });

  describe('a message with a queued destination (#243)', () => {
    const queuedConfig = makeConfig({
      destinations: [{ metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'ALWAYS' }],
    });

    it('reports it queued while the queue has not delivered', async () => {
      const store = { ...makeStore(), isFullyDelivered: vi.fn().mockResolvedValue(ok(false)) };
      const processor = new MessageProcessor(sandbox, store, makeSendFn(), queuedConfig, DEFAULT_EXECUTION_OPTIONS);

      const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

      expect(result.ok && result.value.queued).toBe(true);
      expect(store.removeCompletedContent).not.toHaveBeenCalled();
    });

    it('finishes the message itself when the queue delivered before the pipeline was done', async () => {
      const store = { ...makeStore(), isFullyDelivered: vi.fn().mockResolvedValue(ok(true)) };
      const processor = new MessageProcessor(sandbox, store, makeSendFn(), queuedConfig, DEFAULT_EXECUTION_OPTIONS);

      const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

      expect(result.ok && result.value.queued).toBeUndefined();
      expect(store.isFullyDelivered).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 1);
      expect(store.removeCompletedContent).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 1);
    });

    it('counts it queued, and raises an alert, when the store cannot say', async () => {
      const store = { ...makeStore(), isFullyDelivered: vi.fn().mockResolvedValue({ ok: false, value: null, error: new Error('db down') }) };
      const onError = vi.fn().mockResolvedValue(undefined);
      const processor = new MessageProcessor(sandbox, store, makeSendFn(), { ...queuedConfig, onError }, DEFAULT_EXECUTION_OPTIONS);

      const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

      expect(result.ok && result.value.queued).toBe(true);
      expect(store.removeCompletedContent).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: expect.stringContaining('db down') }));
    });

    it('does not ask the store when nothing was queued', async () => {
      const store = { ...makeStore(), isFullyDelivered: vi.fn().mockResolvedValue(ok(true)) };
      const processor = new MessageProcessor(sandbox, store, makeSendFn(), makeConfig(), DEFAULT_EXECUTION_OPTIONS);

      const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

      expect(result.ok && result.value.queued).toBeUndefined();
      expect(store.isFullyDelivered).not.toHaveBeenCalled();
    });
  });

  it('ALWAYS: queues without attempting a direct send', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [{ metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'ALWAYS' }],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults[0]!.status).toBe('QUEUED');
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('errors the destination when the SENT content write fails (before send)', async () => {
    const store = makeStore();
    // Fail only the CONTENT_TYPE.SENT (5) write; other content writes succeed.
    (store.storeContent as ReturnType<typeof vi.fn>).mockImplementation(
      (_c: string, _m: number, _md: number, contentType: number) =>
        contentType === 5
          ? Promise.resolve({ ok: false, value: null, error: new Error('disk full') })
          : Promise.resolve(ok(undefined)),
    );
    const sendFn = makeSendFn();
    const processor = new MessageProcessor(sandbox, store, sendFn, makeConfig(), DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationResults[0]!.status).toBe('ERROR');
    // Must error before sending — never deliver un-persisted PHI.
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
        { metaDataId: 1, name: 'Dest 1', enabled: false, scripts: {}, queueMode: 'NEVER' },
        { metaDataId: 2, name: 'Dest 2', enabled: true, scripts: {}, queueMode: 'NEVER' },
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

  it('reports ERROR when source transformer throws', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        sourceTransformer: { code: 'throw new Error("Testing error handling!");' },
      },
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(result.value.destinationResults).toHaveLength(0);
    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 0, 13, expect.stringContaining('Testing error handling'), 'TEXT',
    );
    expect(store.incrementStats).toHaveBeenCalledWith(
      expect.any(String), 0, expect.any(String), 'errored',
    );
    expect(sendFn).not.toHaveBeenCalled();
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

  it('destination filter script error marks the destination ERROR and does not send', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [{
        metaDataId: 1, name: 'Dest 1', enabled: true,
        scripts: { filter: { code: 'throw new Error("filter boom");' } },
        queueMode: 'NEVER',
      }],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(result.value.destinationResults[0]!.status).toBe('ERROR');
    expect(sendFn).not.toHaveBeenCalled();
    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 1, 13, expect.stringContaining('filter boom'), 'TEXT',
    );
    expect(store.incrementStats).toHaveBeenCalledWith(expect.any(String), 1, expect.any(String), 'errored');
  });

  it('destination transformer script error marks ERROR and never sends untransformed data', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [{
        metaDataId: 1, name: 'Dest 1', enabled: true,
        scripts: { transformer: { code: 'throw new Error("transform boom");' } },
        queueMode: 'NEVER',
      }],
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(result.value.destinationResults[0]!.status).toBe('ERROR');
    expect(sendFn).not.toHaveBeenCalled();
    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 1, 13, expect.stringContaining('transform boom'), 'TEXT',
    );
  });

  it('preprocessor returning boolean true does not corrupt the message to "true"', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: { preprocessor: { code: 'return true;' } },
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage(makeInput('ORIGINAL_MSG'), AbortSignal.timeout(5_000));

    expect(sendFn).toHaveBeenCalledWith(1, 1,'ORIGINAL_MSG', expect.any(AbortSignal), expect.any(String), undefined);
  });

  it.each([
    ['a blank record', '001\n\n003\n', {}],
    ['a CR inside a quoted value', '1,"two\r\nlines"\r\n', {}],
  ])('a Delimited preprocessor that changes nothing keeps %s', async (_name, text, delimited) => {
    const sendFn = makeSendFn();
    const config = makeConfig({
      dataType: 'DELIMITED',
      dataTypeOptions: { delimited: delimitedOptionsSchema.parse(delimited) },
      scripts: { globalPreprocessor: { code: 'logger.info("seen");' }, preprocessor: { code: 'logger.info(msg.length);' } },
    });
    const processor = new MessageProcessor(sandbox, makeStore(), sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage(makeInput(text), AbortSignal.timeout(5_000));

    expect(sendFn).toHaveBeenCalledWith(1, 1, text, expect.any(AbortSignal), expect.any(String), undefined);
  });

  it('a Delimited preprocessor that edits a row writes the rows back', async () => {
    const sendFn = makeSendFn();
    const config = makeConfig({
      dataType: 'DELIMITED',
      scripts: { preprocessor: { code: 'msg[0].column2 = "X";' } },
    });
    const processor = new MessageProcessor(sandbox, makeStore(), sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    await processor.processMessage(makeInput('1,2\n'), AbortSignal.timeout(5_000));

    expect(sendFn).toHaveBeenCalledWith(1, 1, '1,X\n', expect.any(AbortSignal), expect.any(String), undefined);
  });

  it('does not count the source as SENT when the only destination errors (stats overcount)', async () => {
    const store = makeStore();
    const sendFn: SendToDestination = vi.fn().mockResolvedValue({
      ok: false, value: null, error: { message: 'Connection refused' },
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, makeConfig(), DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(store.incrementStats).toHaveBeenCalledWith(expect.any(String), 0, expect.any(String), 'errored');
    expect(store.incrementStats).not.toHaveBeenCalledWith(expect.any(String), 0, expect.any(String), 'sent');
  });

  it('postprocessor script error surfaces as ERROR, stores error content, and alerts', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const onError = vi.fn().mockResolvedValue(undefined);
    const config = makeConfig({
      scripts: { postprocessor: { code: 'throw new Error("post fail");' } },
      onError,
    });
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(store.storeContent).toHaveBeenCalledWith(
      expect.any(String), 1, 0, 13, expect.stringContaining('post fail'), 'TEXT',
    );
    expect(store.incrementStats).toHaveBeenCalledWith(expect.any(String), 0, expect.any(String), 'errored');
    expect(onError).toHaveBeenCalled();
  });

  it('destination transformer modifies content before send', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      destinations: [{
        metaDataId: 1, name: 'Dest 1', enabled: true,
        scripts: { transformer: { code: 'return "DEST_TRANSFORMED";' } },
        queueMode: 'NEVER',
      }],
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(sendFn).toHaveBeenCalledWith(1, 1,'DEST_TRANSFORMED', expect.any(AbortSignal), expect.any(String), undefined);
  });

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

    expect(sendFn).toHaveBeenCalledWith(1, 1,expect.any(String), expect.any(AbortSignal), expect.any(String), undefined);
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

    expect(sendFn).toHaveBeenCalledWith(1, 1,'GLOBAL_MODIFIED', expect.any(AbortSignal), expect.any(String), undefined);
  });

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

    expect(sendFn).toHaveBeenCalledWith(1, 1,'hello', expect.any(AbortSignal), expect.any(String), undefined);
  });

  it('source transformer removes destination via destinationSet', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const config = makeConfig({
      scripts: {
        sourceTransformer: { code: 'destinationSet.remove("Dest 2"); return rawData;' },
      },
      destinations: [
        { metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'NEVER' },
        { metaDataId: 2, name: 'Dest 2', enabled: true, scripts: {}, queueMode: 'NEVER' },
      ],
    });
    const processor = new MessageProcessor(
      sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS,
    );

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
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
        { metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'NEVER' },
        { metaDataId: 2, name: 'Dest 2', enabled: true, scripts: {}, queueMode: 'NEVER' },
        { metaDataId: 3, name: 'Dest 3', enabled: true, scripts: {}, queueMode: 'NEVER' },
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

  it('stores sourceMap as JSON string after raw content', async () => {
    const store = makeStore();
    const sendFn = makeSendFn();
    const processor = new MessageProcessor(
      sandbox, store, sendFn, makeConfig(), DEFAULT_EXECUTION_OPTIONS,
    );

    await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    // CONTENT_TYPE.SOURCE_MAP = 9
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

    // A rejected store write comes back as a failed Result, not a throw.
    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

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

    const calls = (store.storeContent as ReturnType<typeof vi.fn>).mock.calls;
    const sourceMapCall = calls.find((c) => c[3] === 9);
    expect(sourceMapCall).toBeDefined();
  });
});

describe('groupDestinationChains', () => {
  const dest = (metaDataId: number, waitForPrevious?: boolean): DestinationConfig => ({
    metaDataId, name: `D${String(metaDataId)}`, enabled: true, scripts: {}, queueMode: 'NEVER',
    ...(waitForPrevious === undefined ? {} : { waitForPrevious }),
  });
  const ids = (chains: ReadonlyArray<readonly DestinationConfig[]>): number[][] =>
    chains.map((c) => c.map((d) => d.metaDataId));

  it('returns no chains for no destinations', () => {
    expect(groupDestinationChains([])).toEqual([]);
  });

  it('puts every destination in its own chain by default', () => {
    expect(ids(groupDestinationChains([dest(1), dest(2, false), dest(3)]))).toEqual([[1], [2], [3]]);
  });

  it('joins waitForPrevious destinations to the chain before them', () => {
    expect(ids(groupDestinationChains([dest(1), dest(2, true), dest(3), dest(4, true), dest(5, true)])))
      .toEqual([[1, 2], [3, 4, 5]]);
  });

  it('starts a chain when the first destination has waitForPrevious', () => {
    expect(ids(groupDestinationChains([dest(1, true), dest(2, true)]))).toEqual([[1, 2]]);
  });
});

describe('MessageProcessor reports where an error happened', () => {
  let localSandbox: VmSandboxExecutor;
  beforeEach(() => { localSandbox = new VmSandboxExecutor(); });
  afterEach(() => { localSandbox.dispose(); });

  async function run(config: PipelineConfig, sendFn: SendToDestination = makeSendFn(), content?: string): Promise<{ status: string; errorStage: string | undefined }> {
    const processor = new MessageProcessor(localSandbox, makeStore(), sendFn, config, DEFAULT_EXECUTION_OPTIONS);
    const result = await processor.processMessage(makeInput(content), AbortSignal.timeout(5_000));
    if (!result.ok) throw new Error(result.error.message);
    return { status: result.value.status, errorStage: result.value.errorStage };
  }

  it('has no error stage for a delivered message', async () => {
    expect(await run(makeConfig())).toEqual({ status: 'SENT', errorStage: undefined });
  });

  it('is SOURCE when the content is not valid for the data type', async () => {
    expect(await run(makeConfig({ dataType: 'JSON' }), makeSendFn(), 'not json')).toEqual({ status: 'ERROR', errorStage: 'SOURCE' });
  });

  it('is SOURCE when the source transformer throws, and nothing is sent', async () => {
    const sendFn = makeSendFn();
    const config = makeConfig({ scripts: { sourceTransformer: { code: 'throw new Error("boom");' } } });

    expect(await run(config, sendFn)).toEqual({ status: 'ERROR', errorStage: 'SOURCE' });
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('is DESTINATION when a destination send fails', async () => {
    const sendFn = vi.fn().mockResolvedValue({ ok: false, value: null, error: new Error('conn refused') }) as SendToDestination;

    expect(await run(makeConfig(), sendFn)).toEqual({ status: 'ERROR', errorStage: 'DESTINATION' });
  });

  it('is DESTINATION when the postprocessor throws after delivery', async () => {
    const config = makeConfig({ scripts: { postprocessor: { code: 'throw new Error("late");' } } });

    expect(await run(config)).toEqual({ status: 'ERROR', errorStage: 'DESTINATION' });
  });

  describe('destination rows and store failures', () => {
    const twoChained = [
      { metaDataId: 1, name: 'Dest 1', enabled: true, scripts: {}, queueMode: 'NEVER' as const },
      { metaDataId: 2, name: 'Dest 2', enabled: true, scripts: {}, queueMode: 'NEVER' as const, waitForPrevious: true },
    ];

    it('creates every destination row before the source is marked TRANSFORMED and before any send', async () => {
      const order: string[] = [];
      const store = makeStore();
      (store.createConnectorMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_c: string, _m: number, metaDataId: number) => {
        order.push(`row:${String(metaDataId)}`);
        return ok(undefined);
      });
      (store.updateConnectorMessageStatus as ReturnType<typeof vi.fn>).mockImplementation(async (_c: string, _m: number, metaDataId: number, status: string) => {
        order.push(`status:${String(metaDataId)}:${status}`);
        return ok(undefined);
      });
      const send = vi.fn().mockImplementation(async (metaDataId: number) => {
        order.push(`send:${String(metaDataId)}`);
        return ok({ status: 'SENT' as const, content: 'ACK' });
      });
      const processor = new MessageProcessor(sandbox, store, send, makeConfig({ destinations: twoChained }), DEFAULT_EXECUTION_OPTIONS);

      await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

      const transformedAt = order.indexOf('status:0:TRANSFORMED');
      const firstSend = order.indexOf('send:1');
      expect(order.indexOf('row:1')).toBeLessThan(transformedAt);
      expect(order.indexOf('row:2')).toBeLessThan(transformedAt);
      expect(transformedAt).toBeLessThan(firstSend);
    });

    it('errors the message and sends nothing when a destination row cannot be created', async () => {
      const store = makeStore();
      (store.createConnectorMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_c: string, _m: number, metaDataId: number) =>
        metaDataId === 2 ? { ok: false, value: null, error: new Error('db down') } : ok(undefined));
      const send = makeSendFn();
      const processor = new MessageProcessor(sandbox, store, send, makeConfig({ destinations: twoChained }), DEFAULT_EXECUTION_OPTIONS);

      const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

      expect(result.ok && result.value.status).toBe('ERROR');
      expect(send).not.toHaveBeenCalled();
    });

    it('errors the message and sends nothing when the TRANSFORMED status cannot be saved', async () => {
      const store = makeStore();
      (store.updateConnectorMessageStatus as ReturnType<typeof vi.fn>).mockImplementation(async (_c: string, _m: number, _d: number, status: string) =>
        status === 'TRANSFORMED' ? { ok: false, value: null, error: new Error('db down') } : ok(undefined));
      const send = makeSendFn();
      const processor = new MessageProcessor(sandbox, store, send, makeConfig({ destinations: twoChained }), DEFAULT_EXECUTION_OPTIONS);

      const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

      expect(result.ok && result.value.status).toBe('ERROR');
      expect(send).not.toHaveBeenCalled();
    });

    it('reports a delivered destination whose SENT status could not be saved', async () => {
      const store = makeStore();
      (store.updateConnectorMessageStatus as ReturnType<typeof vi.fn>).mockImplementation(async (_c: string, _m: number, metaDataId: number, status: string) =>
        metaDataId === 1 && status === 'SENT' ? { ok: false, value: null, error: new Error('db down') } : ok(undefined));
      const onStoreFailure = vi.fn();
      const processor = new MessageProcessor(sandbox, store, makeSendFn(), makeConfig({ onStoreFailure }), DEFAULT_EXECUTION_OPTIONS);

      const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

      expect(result.ok && result.value.destinationResults[0]?.status).toBe('SENT');
      expect(onStoreFailure).toHaveBeenCalledWith(expect.objectContaining({
        channelId: '00000000-0000-0000-0000-000000000001', metaDataId: 1, what: 'the SENT status of a delivered destination', errorMessage: 'db down',
      }));
    });

    it('reports a message whose final status could not be saved', async () => {
      const store = makeStore();
      (store.markProcessed as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, value: null, error: new Error('db down') });
      const onStoreFailure = vi.fn();
      const processor = new MessageProcessor(sandbox, store, makeSendFn(), makeConfig({ onStoreFailure }), DEFAULT_EXECUTION_OPTIONS);

      await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

      expect(onStoreFailure).toHaveBeenCalledWith(expect.objectContaining({ metaDataId: 0, what: 'the final message status' }));
    });

    it('fails the message when its first rows cannot be saved', async () => {
      const store = makeStore();
      (store.storeContent as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, value: null, error: new Error('db down') });
      const send = makeSendFn();
      const processor = new MessageProcessor(sandbox, store, send, makeConfig(), DEFAULT_EXECUTION_OPTIONS);

      const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });
  });
});

describe('MessageProcessor script results', () => {
  async function run(config: PipelineConfig, sendFn: SendToDestination = makeSendFn(), store: MessageStore = makeStore()): Promise<{ status: string; store: MessageStore; sendFn: SendToDestination }> {
    const processor = new MessageProcessor(sandbox, store, sendFn, config, DEFAULT_EXECUTION_OPTIONS);
    const result = await processor.processMessage(makeInput('original'), AbortSignal.timeout(5_000));
    if (!result.ok) throw new Error(result.error.message);
    return { status: result.value.status, store, sendFn };
  }

  it.each([
    ['nothing', 'var x = 1;'],
    ['null', 'return null;'],
    ['zero', 'return 0;'],
    ['a truthy value', "return 'yes';"],
  ])('does not send a message whose source filter returns %s', async (_name, code) => {
    const { status, sendFn } = await run(makeConfig({ scripts: { sourceFilter: { code } } }));

    expect(status).toBe('FILTERED');
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('does not send to a destination whose filter returns nothing', async () => {
    const config = makeConfig({
      destinations: [{ metaDataId: 1, name: 'Dest 1', enabled: true, scripts: { filter: { code: 'var x = 1;' } }, queueMode: 'NEVER' }],
    });

    const { sendFn } = await run(config);

    expect(sendFn).not.toHaveBeenCalled();
  });

  it('sends when the filter returns true', async () => {
    const { status, sendFn } = await run(makeConfig({ scripts: { sourceFilter: { code: 'return true;' } } }));

    expect(status).toBe('SENT');
    expect(sendFn).toHaveBeenCalledOnce();
  });

  it.each([
    ['true', 'return true;'],
    ['false', 'return false;'],
    ['nothing', 'return;'],
  ])('keeps the message when a source transformer returns %s', async (_name, code) => {
    const { sendFn } = await run(makeConfig({ scripts: { sourceTransformer: { code } } }));

    expect(vi.mocked(sendFn).mock.calls[0]![2]).toBe('original');
  });

  it('keeps the message when a destination transformer returns true', async () => {
    const config = makeConfig({
      destinations: [{ metaDataId: 1, name: 'Dest 1', enabled: true, scripts: { transformer: { code: 'return true;' } }, queueMode: 'NEVER' }],
    });

    const { sendFn } = await run(config);

    expect(vi.mocked(sendFn).mock.calls[0]![2]).toBe('original');
  });

  it('still lets a transformer replace the message by returning text', async () => {
    const { sendFn } = await run(makeConfig({ scripts: { sourceTransformer: { code: "return 'replaced';" } } }));

    expect(vi.mocked(sendFn).mock.calls[0]![2]).toBe('replaced');
  });

  it('keeps the response when a response transformer returns true', async () => {
    const store = makeStore();
    const config = makeConfig({
      destinations: [{ metaDataId: 1, name: 'Dest 1', enabled: true, scripts: { responseTransformer: { code: 'return true;' } }, queueMode: 'NEVER' }],
    });

    await run(config, makeSendFn({ status: 'SENT', content: 'the response' }), store);

    const stored = vi.mocked(store.storeContent).mock.calls.find((c) => c[3] === 7);
    expect(stored?.[4]).toBe('the response');
  });

  it('stores both postprocessor errors as one error text', async () => {
    const store = makeStore();
    const config = makeConfig({
      scripts: { postprocessor: { code: "throw new Error('first');" }, globalPostprocessor: { code: "throw new Error('second');" } },
    });

    const { status } = await run(config, makeSendFn(), store);

    const errors = vi.mocked(store.storeContent).mock.calls.filter((c) => c[3] === 13);
    expect(status).toBe('ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0]![4]).toContain('postprocessor: first');
    expect(errors[0]![4]).toContain('globalPostprocessor: second');
  });
});

describe('MessageProcessor finishes a message that fails unexpectedly', () => {
  it('marks the message ERROR and processed when a stage throws after the message was created', async () => {
    const store = makeStore();
    const onError = vi.fn().mockResolvedValue(undefined);
    const sendFn: SendToDestination = vi.fn().mockRejectedValue(new Error('connector blew up'));
    const processor = new MessageProcessor(sandbox, store, sendFn, makeConfig({ onError }), DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('ERROR');
    expect(result.value.messageId).toBe(1);
    expect(store.updateConnectorMessageStatus).toHaveBeenCalledWith(expect.anything(), 1, 0, 'ERROR');
    expect(store.markProcessed).toHaveBeenCalledWith(expect.anything(), 1);
    const errorText = vi.mocked(store.storeContent).mock.calls.find((c) => c[3] === 13)?.[4];
    expect(errorText).toContain('connector blew up');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: expect.stringContaining('connector blew up') as string }));
  });

  it('fails the message when a transformer returns something that cannot be stored', async () => {
    const store = makeStore();
    const config = makeConfig({ scripts: { sourceTransformer: { code: 'var a = {}; a.self = a; return a;' } } });
    const processor = new MessageProcessor(sandbox, store, makeSendFn(), config, DEFAULT_EXECUTION_OPTIONS);

    const result = await processor.processMessage(makeInput(), AbortSignal.timeout(5_000));

    expect(result.ok && result.value.status).toBe('ERROR');
    expect(store.markProcessed).toHaveBeenCalledOnce();
  });
});
