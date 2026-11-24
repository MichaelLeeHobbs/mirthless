import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bundleOf } from '../../../test/deployment-bundle.js';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@galvanigraph/connectors', () => ({
  createSourceConnector: vi.fn().mockReturnValue({
    setDispatcher: vi.fn(),
    onDeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onStart: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onStop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onHalt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onUndeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  }),
  createDestinationConnector: vi.fn().mockReturnValue({
    send: (...args: unknown[]) => mockSend(...args),
    onDeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onStart: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onStop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onHalt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onUndeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  }),
  JavaScriptReceiver: vi.fn(),
  JavaScriptDispatcher: vi.fn(),
  DISPATCH_STATUS: { PROCESSED: 'PROCESSED', FILTERED: 'FILTERED', ERROR: 'ERROR' },
}));

const ms = vi.hoisted(() => ({
  getLatestMessageId: vi.fn(),
  getUnprocessedMessages: vi.fn(),
  getConnectorMessages: vi.fn(),
  loadContent: vi.fn(),
  storeContent: vi.fn(),
  updateConnectorMessageStatus: vi.fn(),
  incrementStats: vi.fn(),
  markProcessed: vi.fn(),
  resetPending: vi.fn(),
  initializeMessage: vi.fn(),
  finalizeMessage: vi.fn(),
  createConnectorMessage: vi.fn(),
}));
vi.mock('../message.service.js', () => ({ MessageService: ms }));

const mockGlobalMapList = vi.fn();
const mockPersist = vi.fn();
const mockPersistRemoval = vi.fn();
vi.mock('../global-map.service.js', () => ({
  GlobalMapService: {
    list: mockGlobalMapList,
    persist: mockPersist,
    persistRemoval: mockPersistRemoval,
    onChange: vi.fn(),
  },
}));

const mockConfigMapList = vi.fn();
vi.mock('../config-map.service.js', () => ({
  ConfigMapService: { list: mockConfigMapList },
}));

vi.mock('../alert.service.js', () => ({
  AlertService: {
    list: vi.fn().mockResolvedValue({
      ok: true, value: { data: [], pagination: { page: 1, pageSize: 1000, total: 0, totalPages: 0 } }, error: null,
    }),
    getByIds: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
  },
}));

vi.mock('../email.service.js', () => ({
  EmailService: { sendMail: vi.fn() },
}));

vi.mock('../../lib/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../config/index.js', () => ({
  config: { LOG_LEVEL: 'info', NODE_ENV: 'test' },
}));

// Must import after mocks
const { EngineManager } = await import('../../engine.js');
const { createDestinationConnector } = await import('@galvanigraph/connectors');

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const OK_EMPTY = { ok: true, value: [], error: null };

function makeChannel(overrides: Record<string, unknown> = {}): never {
  return {
    id: CHANNEL_ID,
    name: 'Labs',
    enabled: true,
    sourceConnectorType: 'TCP_MLLP',
    sourceConnectorProperties: { port: 6661 },
    inboundDataType: 'HL7V2',
    outboundDataType: 'HL7V2',
    messageStorageMode: 'DEVELOPMENT',
    metadataColumns: [],
    destinations: [],
    scripts: [],
    filters: [],
    transformers: [],
    ...overrides,
  } as never;
}

const OK = { ok: true, value: undefined, error: null };
const ok = <T>(value: T): { ok: true; value: T; error: null } => ({ ok: true, value, error: null });
const DEST = { id: 'd1', metaDataId: 1, name: 'Lab', enabled: true, connectorType: 'HTTP', properties: {}, queueMode: 'NEVER' };

beforeEach(() => {
  vi.clearAllMocks();
  mockConfigMapList.mockResolvedValue(OK_EMPTY);
  mockGlobalMapList.mockResolvedValue(OK_EMPTY);
  mockSend.mockResolvedValue(ok({ status: 'SENT', content: 'ACK' }));
  for (const fn of Object.values(ms)) fn.mockResolvedValue(OK);
  ms.getLatestMessageId.mockResolvedValue(ok(40));
  ms.getUnprocessedMessages.mockResolvedValue(ok([]));
  ms.getConnectorMessages.mockResolvedValue(ok([]));
  ms.loadContent.mockResolvedValue(ok(null));
  ms.initializeMessage.mockResolvedValue(ok({ messageId: 99, correlationId: '00000000-0000-0000-0000-000000000099' }));
});

async function deployAndRecover(): Promise<InstanceType<typeof EngineManager>> {
  const engine = new EngineManager('test-server');
  await engine.deploy(bundleOf(makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [DEST] })));
  const deployed = engine.getRuntime(CHANNEL_ID)!;
  await deployed.runtime.start();
  await deployed.recoverOnce();
  return engine;
}

describe('EngineManager recovery', () => {
  it('only recovers messages that were already there when the channel was deployed', async () => {
    const engine = await deployAndRecover();

    expect(ms.getLatestMessageId).toHaveBeenCalledWith(CHANNEL_ID);
    expect(ms.getUnprocessedMessages).toHaveBeenCalledWith(CHANNEL_ID, { afterId: 0, maxId: 40 }, 200);
    await engine.dispose();
  });

  it('skips recovery, loudly, when it cannot tell old messages from new ones', async () => {
    const logger = (await import('../../lib/logger.js')).default;
    ms.getLatestMessageId.mockResolvedValue({ ok: false, value: null, error: new Error('db down') });

    const engine = await deployAndRecover();
    await engine.getRuntime(CHANNEL_ID)!.recoverOnce();

    expect(ms.getUnprocessedMessages).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ channelId: CHANNEL_ID, errMsg: 'db down' }), expect.stringContaining('recovery'));
    await engine.dispose();
  });

  it('re-sends a destination that was ready to send when the server stopped', async () => {
    ms.getUnprocessedMessages.mockResolvedValue(ok([{ id: 7, channelId: CHANNEL_ID }]));
    ms.getConnectorMessages.mockResolvedValue(ok([
      { messageId: 7, metaDataId: 0, status: 'TRANSFORMED' }, { messageId: 7, metaDataId: 1, status: 'RECEIVED' },
    ]));
    ms.loadContent.mockResolvedValue(ok('payload'));

    const engine = await deployAndRecover();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(ms.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL_ID, 7, 1, 'SENT', undefined);
    expect(ms.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 7);
    await engine.dispose();
  });

  it('marks a destination that never got as far as sending as an error, instead of calling the message done', async () => {
    const logger = (await import('../../lib/logger.js')).default;
    ms.getUnprocessedMessages.mockResolvedValue(ok([{ id: 7, channelId: CHANNEL_ID }]));
    ms.getConnectorMessages.mockResolvedValue(ok([
      { messageId: 7, metaDataId: 0, status: 'TRANSFORMED' }, { messageId: 7, metaDataId: 1, status: 'RECEIVED' },
    ]));
    ms.loadContent.mockResolvedValue(ok(null));

    const engine = await deployAndRecover();

    expect(mockSend).not.toHaveBeenCalled();
    expect(ms.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL_ID, 7, 1, 'ERROR', undefined);
    expect(ms.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL_ID, 7, 0, 'ERROR', undefined);
    expect(ms.storeContent.mock.calls.map((c: unknown[]) => c.slice(0, 5))).toContainEqual([CHANNEL_ID, 7, 1, 13, expect.stringContaining('Reprocess the message')]);
    expect(ms.incrementStats).toHaveBeenCalledWith(CHANNEL_ID, 1, 'test-server', 'errored');
    expect(ms.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 7);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ channelId: CHANNEL_ID, messageId: 7, metaDataId: 1 }), expect.stringContaining('never'));
    await engine.dispose();
  });

  it('closes the interrupted original when it runs the message again, pointing at the new one', async () => {
    ms.getUnprocessedMessages.mockResolvedValue(ok([{ id: 7, channelId: CHANNEL_ID }]));
    ms.getConnectorMessages.mockResolvedValue(ok([{ messageId: 7, metaDataId: 0, status: 'RECEIVED' }]));
    ms.loadContent.mockImplementation(async (_c: string, _m: number, _d: number, contentType: number) => ok(contentType === 1 ? 'payload' : null));

    const engine = await deployAndRecover();

    // The original is no longer left looking like a message still being received.
    expect(ms.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL_ID, 7, 0, 'ERROR', undefined);
    expect(ms.storeContent.mock.calls.map((c: unknown[]) => c.slice(0, 5)))
      .toContainEqual([CHANNEL_ID, 7, 0, 13, expect.stringContaining('message 99')]);
    expect(ms.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 7);
    // Counted once, as the new message: the original adds no error to the statistics.
    expect(ms.incrementStats).not.toHaveBeenCalledWith(CHANNEL_ID, 0, 'test-server', 'errored');
    await engine.dispose();
  });

  it('logs a store failure the pipeline reports', async () => {
    const logger = (await import('../../lib/logger.js')).default;
    ms.finalizeMessage.mockResolvedValue({ ok: false, value: null, error: new Error('db down') });
    const engine = await deployAndRecover();

    await engine.getRuntime(CHANNEL_ID)!.processMessage('x');

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: CHANNEL_ID, messageId: 99, what: 'the final message status', errMsg: 'db down' }),
      expect.stringContaining('could not be saved'),
    );
    await engine.dispose();
  });

  it('finishes the source of a message whose destination was redelivered', async () => {
    ms.getUnprocessedMessages.mockResolvedValue(ok([{ id: 8, channelId: CHANNEL_ID }]));
    ms.getConnectorMessages
      .mockResolvedValueOnce(ok([{ messageId: 8, metaDataId: 0, status: 'TRANSFORMED' }, { messageId: 8, metaDataId: 1, status: 'RECEIVED' }]))
      .mockResolvedValue(ok([{ messageId: 8, metaDataId: 0, status: 'TRANSFORMED' }, { messageId: 8, metaDataId: 1, status: 'SENT' }]));
    ms.loadContent.mockImplementation(async (_c: string, _m: number, _d: number, contentType: number) => ok(contentType === 5 ? 'ready to send' : null));

    const engine = await deployAndRecover();

    expect(ms.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL_ID, 8, 0, 'SENT', undefined);
    expect(ms.incrementStats).toHaveBeenCalledWith(CHANNEL_ID, 0, 'test-server', 'sent');
    expect(ms.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 8);
    await engine.dispose();
  });

  describe('interrupted by a stop', () => {
    const READY = { messageId: 7, metaDataId: 1, status: 'RECEIVED' };

    /** A channel with one message to send again, whose send ends only when it is told how, or is aborted. */
    async function recovering({ ignoresItsSignal = false } = {}): Promise<{
      readonly engine: InstanceType<typeof EngineManager>;
      readonly deployed: NonNullable<ReturnType<InstanceType<typeof EngineManager>['getRuntime']>>;
      readonly done: Promise<void>;
      readonly answer: (result: unknown) => void;
      readonly destinationStop: ReturnType<typeof vi.fn>;
    }> {
      ms.getUnprocessedMessages.mockResolvedValue(ok([{ id: 7, channelId: CHANNEL_ID }]));
      ms.getConnectorMessages.mockResolvedValue(ok([{ messageId: 7, metaDataId: 0, status: 'TRANSFORMED' }, READY]));
      ms.loadContent.mockResolvedValue(ok('payload'));
      let answer: (result: unknown) => void = () => undefined;
      mockSend.mockImplementation((_message: unknown, signal: AbortSignal) => new Promise((resolve) => {
        answer = resolve;
        if (!ignoresItsSignal) signal.addEventListener('abort', () => { resolve({ ok: false, value: null, error: new Error('Send aborted') }); });
      }));
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [DEST] })));
      const deployed = engine.getRuntime(CHANNEL_ID)!;
      await deployed.runtime.start();
      const done = deployed.recoverOnce();
      await vi.waitFor(() => { expect(mockSend).toHaveBeenCalledTimes(1); });
      const destinationStop = vi.mocked(createDestinationConnector).mock.results.at(-1)!.value.onStop as ReturnType<typeof vi.fn>;
      return { engine, deployed, done, answer: (result) => { answer(result); }, destinationStop };
    }

    it('a halt ends the send, leaves its destination as it was, and the next start sends it again', async () => {
      const { engine, deployed, done } = await recovering();

      await deployed.runtime.halt();
      await done;
      expect(ms.updateConnectorMessageStatus).not.toHaveBeenCalled();
      expect(ms.incrementStats).not.toHaveBeenCalled();
      expect(ms.markProcessed).not.toHaveBeenCalled();

      mockSend.mockResolvedValue(ok({ status: 'SENT', content: 'ACK' }));
      await deployed.runtime.start();
      await deployed.recoverOnce();
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(ms.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL_ID, 7, 1, 'SENT', undefined);

      // That one went through every message, so a later start has nothing to recover.
      await deployed.runtime.stop();
      await deployed.runtime.start();
      await deployed.recoverOnce();
      expect(mockSend).toHaveBeenCalledTimes(2);
      await engine.dispose();
    });

    it('a send has 30 seconds', async () => {
      const expiry = new AbortController();
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(expiry.signal);
      try {
        const { engine, done } = await recovering();
        expect(timeout).toHaveBeenCalledWith(30_000);
        expiry.abort();
        await done;
        expect(ms.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL_ID, 7, 1, 'ERROR', undefined);
        await engine.dispose();
      } finally {
        timeout.mockRestore();
      }
    });

    it.each([
      ['delivered', ok({ status: 'SENT', content: 'ACK' }), 'SENT'],
      ['refused', ok({ status: 'ERROR', content: 'NAK', errorMessage: 'refused' }), 'ERROR'],
      ['failed', { ok: false, value: null, error: new Error('Connection refused') }, 'ERROR'],
    ])('a stop waits for the send before it stops the destination, and keeps that it was %s', async (_how, result, status) => {
      const { engine, deployed, done, answer, destinationStop } = await recovering();

      const stopped = deployed.runtime.stop();
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(destinationStop).not.toHaveBeenCalled();
      answer(result);
      await Promise.all([done, stopped]);

      expect(destinationStop).toHaveBeenCalledOnce();
      expect(ms.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL_ID, 7, 1, status, undefined);
      await engine.dispose();
    });

    it('a refusal that comes as the channel is halted is kept, not asked for again', async () => {
      const { engine, deployed, done, answer } = await recovering({ ignoresItsSignal: true });

      await deployed.runtime.halt();
      answer(ok({ status: 'ERROR', content: 'NAK', errorMessage: 'refused' }));
      await done;

      expect(ms.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL_ID, 7, 1, 'ERROR', undefined);
      await engine.dispose();
    });

    it('a start waits for the interrupted recovery before it recovers again', async () => {
      const { engine, deployed, done, answer } = await recovering({ ignoresItsSignal: true });
      await deployed.runtime.halt();
      await deployed.runtime.start();
      const second = deployed.recoverOnce();
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(ms.getUnprocessedMessages).toHaveBeenCalledTimes(1);

      mockSend.mockResolvedValue(ok({ status: 'SENT', content: 'ACK' }));
      answer({ ok: false, value: null, error: new Error('Dispatcher not started') });
      await Promise.all([done, second]);

      expect(ms.getUnprocessedMessages).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenCalledTimes(2);
      await engine.dispose();
    });

    it('an undeploy waits for a recovery that a halt could not cancel', async () => {
      const { engine, deployed, answer } = await recovering({ ignoresItsSignal: true });
      await deployed.runtime.halt();

      const undeployed = engine.undeploy(CHANNEL_ID);
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(engine.getRuntime(CHANNEL_ID)).toBeDefined();
      answer({ ok: false, value: null, error: new Error('too late') });
      await undeployed;

      expect(engine.getRuntime(CHANNEL_ID)).toBeUndefined();
      await engine.dispose();
    });

    it('an undeploy goes on when that recovery does not end, and says so', async () => {
      const logger = (await import('../../lib/logger.js')).default;
      const { engine, deployed, answer } = await recovering({ ignoresItsSignal: true });
      await deployed.runtime.halt();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const undeployed = engine.undeploy(CHANNEL_ID);
        await vi.advanceTimersByTimeAsync(9_999);
        expect(engine.getRuntime(CHANNEL_ID)).toBeDefined();
        await vi.advanceTimersByTimeAsync(1);
        await undeployed;
      } finally {
        vi.useRealTimers();
      }
      expect(engine.getRuntime(CHANNEL_ID)).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith({ channelId: CHANNEL_ID }, expect.stringContaining('may send it again'));
      answer({ ok: false, value: null, error: new Error('too late') });
      await engine.dispose();
    });

    it('an undeploy is refused, with nothing torn down, when the channel was started while it waited', async () => {
      const { engine, deployed, answer } = await recovering({ ignoresItsSignal: true });
      await deployed.runtime.halt();
      const clear = vi.spyOn(deployed.globalChannelMap, 'clear');

      const undeployed = engine.undeploy(CHANNEL_ID).catch((err: unknown) => err);
      await deployed.runtime.start();
      answer({ ok: false, value: null, error: new Error('too late') });

      expect(await undeployed).toMatchObject({ code: 'CONFLICT', message: 'Cannot undeploy: channel is STARTED' });
      expect(clear).not.toHaveBeenCalled();
      expect(engine.getRuntime(CHANNEL_ID)).toBeDefined();
      await engine.dispose();
    });

    it.each(['stop', 'halt'] as const)('a message is not sent again once a %s has begun, but after the next start', async (action) => {
      ms.getUnprocessedMessages.mockResolvedValue(ok([{ id: 7, channelId: CHANNEL_ID }]));
      ms.getConnectorMessages.mockResolvedValue(ok([{ messageId: 7, metaDataId: 0, status: 'TRANSFORMED' }, READY]));
      let loaded: (result: unknown) => void = () => undefined;
      ms.loadContent.mockImplementationOnce(() => new Promise((resolve) => { loaded = resolve; }));
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [DEST] })));
      const deployed = engine.getRuntime(CHANNEL_ID)!;
      await deployed.runtime.start();
      const done = deployed.recoverOnce();
      await vi.waitFor(() => { expect(ms.loadContent).toHaveBeenCalledOnce(); });

      const ended = deployed.runtime[action]();
      loaded(ok('payload'));
      await Promise.all([done, ended]);
      expect(mockSend).not.toHaveBeenCalled();
      expect(ms.updateConnectorMessageStatus).not.toHaveBeenCalled();

      ms.loadContent.mockResolvedValue(ok('payload'));
      await deployed.runtime.start();
      await deployed.recoverOnce();
      expect(mockSend).toHaveBeenCalledOnce();
      await engine.dispose();
    });

    it.each(['stop', 'halt'] as const)('a message to run again is not run on a channel that a %s has stopped, but after the next start', async (action) => {
      ms.getUnprocessedMessages.mockResolvedValue(ok([{ id: 7, channelId: CHANNEL_ID }]));
      ms.getConnectorMessages.mockResolvedValue(ok([{ messageId: 7, metaDataId: 0, status: 'RECEIVED' }]));
      let loaded: (result: unknown) => void = () => undefined;
      ms.loadContent.mockImplementationOnce(() => new Promise((resolve) => { loaded = resolve; }));
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [DEST] })));
      const deployed = engine.getRuntime(CHANNEL_ID)!;
      await deployed.runtime.start();
      const done = deployed.recoverOnce();
      await vi.waitFor(() => { expect(ms.loadContent).toHaveBeenCalledOnce(); });

      const ended = deployed.runtime[action]();
      loaded(ok('payload'));
      await Promise.all([done, ended]);
      expect(ms.initializeMessage).not.toHaveBeenCalled();
      expect(ms.markProcessed).not.toHaveBeenCalled();

      ms.loadContent.mockImplementation(async (_c: string, _m: number, _d: number, contentType: number) => ok(contentType === 1 ? 'payload' : null));
      await deployed.runtime.start();
      await deployed.recoverOnce();
      expect(ms.initializeMessage).toHaveBeenCalledOnce();
      await engine.dispose();
    });
  });

  it('one that could not read its messages is tried again at the next start', async () => {
    ms.getUnprocessedMessages.mockResolvedValueOnce({ ok: false, value: null, error: new Error('db gone') });
    const engine = await deployAndRecover();
    const deployed = engine.getRuntime(CHANNEL_ID)!;
    expect(ms.getUnprocessedMessages).toHaveBeenCalledTimes(1);

    await deployed.runtime.stop();
    await deployed.runtime.start();
    await deployed.recoverOnce();
    await deployed.recoverOnce();

    expect(ms.getUnprocessedMessages).toHaveBeenCalledTimes(2);
    await engine.dispose();
  });

  it('releases stale queue claims once, separately from recovery', async () => {
    const engine = new EngineManager('test-server');
    await engine.deploy(bundleOf(makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [{ ...DEST, queueMode: 'ALWAYS' }] })));
    const deployed = engine.getRuntime(CHANNEL_ID)!;

    await deployed.resetClaimsOnce();
    await deployed.resetClaimsOnce();
    await deployed.runtime.start();
    await deployed.recoverOnce();

    expect(ms.resetPending).toHaveBeenCalledTimes(1);
    expect(ms.resetPending).toHaveBeenCalledWith(CHANNEL_ID, 1);
    await engine.dispose();
  });
});
