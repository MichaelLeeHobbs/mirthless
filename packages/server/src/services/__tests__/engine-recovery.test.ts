import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MessageDispatcher } from '@galvanigraph/connectors';
import { bundleOf } from '../../../test/deployment-bundle.js';

const mockSend = vi.hoisted(() => vi.fn());
const mockVariablesUsed = vi.hoisted(() => vi.fn());

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
    variablesUsed: (...args: unknown[]) => mockVariablesUsed(...args),
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
  waitingByDestination: vi.fn(),
  isForItsNumber: vi.fn(),
  initializeMessage: vi.fn(),
  resetToReceived: vi.fn(),
  failUnrouted: vi.fn(),
  finalizeMessage: vi.fn(),
  createConnectorMessage: vi.fn(),
  enqueue: vi.fn(),
  removeContent: vi.fn(),
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

const mockEmitEvent = vi.hoisted(() => vi.fn());
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: mockEmitEvent, emitAuditEvent: vi.fn() }));

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
const { createDestinationConnector, createSourceConnector } = await import('@galvanigraph/connectors');

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
  mockVariablesUsed.mockReturnValue([]);
  for (const fn of Object.values(ms)) fn.mockResolvedValue(OK);
  ms.getLatestMessageId.mockResolvedValue(ok(40));
  ms.waitingByDestination.mockResolvedValue(ok([]));
  ms.isForItsNumber.mockResolvedValue(ok(true));
  ms.getUnprocessedMessages.mockResolvedValue(ok([]));
  ms.getConnectorMessages.mockResolvedValue(ok([]));
  ms.loadContent.mockResolvedValue(ok(null));
  ms.initializeMessage.mockResolvedValue(ok({ messageId: 99, correlationId: '00000000-0000-0000-0000-000000000099' }));
});

const alerts = vi.fn();

const RAW = 1;
const SOURCE_MAP = 9;
const FAILED = { ok: false, value: null, error: new Error('cannot decrypt') };
const SENT = 5;
const VARIABLES = 10;
const ERROR = 11;
const PROCESSING_ERROR = 13;

/** What the store holds, by content type. */
function stored(contents: Readonly<Record<number, string>>): (c: string, m: number, d: number, contentType: number) => Promise<unknown> {
  return async (_c, _m, _d, contentType) => ok(contents[contentType] ?? null);
}

const nameOf = (metaDataId: number): string => (metaDataId === 0 ? 'Source' : DEST.name);

/** Message 7, with the statuses as recovery writes them. */
function unfinished(...connectors: readonly (readonly [number, string])[]): Map<number, string> {
  const statuses = new Map(connectors);
  ms.getUnprocessedMessages.mockResolvedValue(ok([{ id: 7, channelId: CHANNEL_ID }]));
  ms.getConnectorMessages.mockImplementation(async () => ok([...statuses].map(([metaDataId, status]) => ({ messageId: 7, metaDataId, status, connectorName: nameOf(metaDataId) }))));
  ms.updateConnectorMessageStatus.mockImplementation(async (_c: string, _m: number, metaDataId: number, status: string) => { statuses.set(metaDataId, status); return OK; });
  ms.enqueue.mockImplementation(async (_c: string, _m: number, metaDataId: number) => { statuses.set(metaDataId, 'QUEUED'); return OK; });
  return statuses;
}

/** A destination's stored content, as [content type, text]. */
const storedFor = (metaDataId: number): unknown[][] => ms.storeContent.mock.calls.filter((c: unknown[]) => c[2] === metaDataId).map((c: unknown[]) => [c[3], c[4]]);

async function deployAndRecover(destination: Record<string, unknown> = DEST): Promise<InstanceType<typeof EngineManager>> {
  const engine = new EngineManager('test-server');
  await engine.deploy(bundleOf(makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [destination] })));
  const deployed = engine.getRuntime(CHANNEL_ID)!;
  vi.spyOn(deployed.alertManager, 'handleEvent').mockImplementation(async (event) => { alerts(event.errorType, event.errorMessage); });
  await deployed.runtime.start();
  await deployed.recoverOnce();
  return engine;
}

describe('EngineManager recovery', () => {
  it.each([
    ['DEVELOPMENT', true],
    ['DISABLED', false],
  ])('tells a source that a message it dispatched is stored, and whether it can be run again, before it is sent (%s)', async (messageStorageMode, recoverable) => {
    ms.initializeMessage.mockResolvedValue(ok({ messageId: 41, correlationId: 'c' }));
    const engine = new EngineManager('test-server');
    await engine.deploy(bundleOf(makeChannel({ destinations: [DEST], inboundDataType: 'RAW', messageStorageMode })));
    const source = vi.mocked(createSourceConnector).mock.results.at(-1)?.value as { setDispatcher: ReturnType<typeof vi.fn> };
    const dispatch = source.setDispatcher.mock.lastCall?.[0] as MessageDispatcher;
    const told: unknown[] = [];

    await dispatch({ content: 'x', sourceMap: {}, onStored: (stored) => { told.push([stored.recoverable, mockSend.mock.calls.length]); } });

    expect(told).toEqual([[recoverable, 0]]);
    expect(mockSend).toHaveBeenCalledOnce();
    await engine.dispose();
  });

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
      { messageId: 7, metaDataId: 0, status: 'TRANSFORMED', connectorName: 'Source' }, { messageId: 7, metaDataId: 1, status: 'RECEIVED', connectorName: 'Lab' },
    ]));
    ms.loadContent.mockImplementation(stored({ [SENT]: 'payload' }));

    const engine = await deployAndRecover();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(ms.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL_ID, 7, 1, 'SENT', undefined);
    expect(ms.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 7);
    await engine.dispose();
  });

  it('marks a destination that never got as far as sending as an error, instead of calling the message done', async () => {
    const logger = (await import('../../lib/logger.js')).default;
    const statuses = unfinished([0, 'TRANSFORMED'], [1, 'RECEIVED']);

    const engine = await deployAndRecover();

    expect(mockSend).not.toHaveBeenCalled();
    expect(statuses).toEqual(new Map([[0, 'ERROR'], [1, 'ERROR']]));
    expect(storedFor(1)).toEqual([[PROCESSING_ERROR, expect.stringContaining('Reprocess the message')]]);
    expect(ms.incrementStats).toHaveBeenCalledWith(CHANNEL_ID, 1, 'test-server', 'errored');
    expect(ms.incrementStats).toHaveBeenCalledWith(CHANNEL_ID, 0, 'test-server', 'errored');
    expect(alerts).toHaveBeenCalledExactlyOnceWith('DESTINATION_CONNECTOR', expect.stringContaining('message 7'));
    expect(ms.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 7);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { channelId: CHANNEL_ID, messageId: 7, metaDataId: 1, reason: expect.stringContaining('nothing is stored to send') }, expect.stringContaining('marked the destination ERROR'),
    );
    await engine.dispose();
  });

  describe('a destination that was ready to send when the server stopped', () => {
    function ready(contents: Readonly<Record<number, string>> = {}): Map<number, string> {
      ms.loadContent.mockImplementation(stored({ [SENT]: 'payload', ...contents }));
      return unfinished([0, 'TRANSFORMED'], [1, 'RECEIVED']);
    }

    it('is sent with the variables stored for it', async () => {
      const statuses = ready({ [VARIABLES]: '{"mrn":"123"}' });
      mockVariablesUsed.mockReturnValue(['mrn']);

      const engine = await deployAndRecover({ ...DEST, queueMode: 'ON_FAILURE' });

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend.mock.calls[0]![0]).toMatchObject({ messageId: 7, metaDataId: 1, content: 'payload', variables: { mrn: '123' } });
      expect(statuses).toEqual(new Map([[0, 'SENT'], [1, 'SENT']]));
      await engine.dispose();
    });

    it('is sent none, as by the pipeline, when an empty set is stored for it', async () => {
      ready({ [VARIABLES]: '{}' });
      mockVariablesUsed.mockReturnValue(['mrn']);

      const engine = await deployAndRecover({ ...DEST, queueMode: 'ON_FAILURE' });

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend.mock.calls[0]![0]).toHaveProperty('variables', undefined);
      await engine.dispose();
    });

    it('is sent to a destination that was renamed since', async () => {
      const statuses = ready();

      const engine = await deployAndRecover({ ...DEST, name: 'Laboratory' });

      expect(mockSend).toHaveBeenCalledOnce();
      expect(statuses).toEqual(new Map([[0, 'SENT'], [1, 'SENT']]));
      await engine.dispose();
    });

    it('is not sent when it comes from when a save renumbered the destinations, and is not known to be for this one', async () => {
      ms.isForItsNumber.mockResolvedValue(ok(false));
      const statuses = ready();

      const engine = await deployAndRecover();

      expect(ms.isForItsNumber).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID, 7, 1);
      expect(mockSend).not.toHaveBeenCalled();
      expect(statuses).toEqual(new Map([[0, 'ERROR'], [1, 'ERROR']]));
      expect(storedFor(1)).toEqual([[PROCESSING_ERROR, expect.stringContaining('not known to be for this one')]]);
      await engine.dispose();
    });

    it('is not sent when its settings use variables and none were kept, and says so', async () => {
      const statuses = ready();
      mockVariablesUsed.mockReturnValue(['mrn', 'dob']);

      const engine = await deployAndRecover();

      expect(mockVariablesUsed).toHaveBeenCalledWith(expect.objectContaining({ messageId: 7, metaDataId: 1, content: 'payload' }));
      expect(mockSend).not.toHaveBeenCalled();
      expect(statuses).toEqual(new Map([[0, 'ERROR'], [1, 'ERROR']]));
      expect(storedFor(1)).toEqual([[PROCESSING_ERROR, expect.stringMatching(/variables \(mrn, dob\).*may have been delivered.*reprocess/i)]]);
      expect(ms.incrementStats).toHaveBeenCalledWith(CHANNEL_ID, 1, 'test-server', 'errored');
      expect(alerts).toHaveBeenCalledExactlyOnceWith('DESTINATION_CONNECTOR', expect.stringContaining('message 7'));
      expect(ms.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 7);
      await engine.dispose();
    });

    it.each([
      ['refuses it', ok({ status: 'ERROR', content: 'NAK', errorMessage: 'refused' }), 'refused'],
      ['cannot be reached', { ok: false, value: null, error: new Error('Connection refused') }, 'Connection refused'],
    ])('keeps why it failed, alerts and ends when the partner %s', async (_how, result, reason) => {
      const statuses = ready();
      mockSend.mockResolvedValue(result);

      const engine = await deployAndRecover();

      expect(statuses).toEqual(new Map([[0, 'ERROR'], [1, 'ERROR']]));
      expect(storedFor(1)).toContainEqual([ERROR, reason]);
      // Not why: what the partner answered may hold PHI.
      const logger = (await import('../../lib/logger.js')).default;
      expect(logger.error).toHaveBeenCalledExactlyOnceWith({ channelId: CHANNEL_ID, messageId: 7, metaDataId: 1 }, expect.stringContaining('marked the destination ERROR'));
      expect(alerts).toHaveBeenCalledExactlyOnceWith('DESTINATION_CONNECTOR', expect.stringContaining(reason));
      expect(ms.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 7);
      await engine.dispose();
    });

    it('goes to its queue when the send fails and it queues on failure, and the message is closed as the pipeline closes one', async () => {
      const statuses = ready();
      mockSend.mockResolvedValue({ ok: false, value: null, error: new Error('Connection refused') });

      const engine = await deployAndRecover({ ...DEST, queueMode: 'ON_FAILURE' });

      expect(mockSend).toHaveBeenCalledOnce();
      expect(statuses).toEqual(new Map([[0, 'SENT'], [1, 'QUEUED']]));
      expect(storedFor(1)).toEqual([[ERROR, 'Connection refused']]);
      expect(alerts).not.toHaveBeenCalled();
      expect(ms.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 7);
      await engine.dispose();
    });

    it('is left as it was, loudly, when its outcome cannot be saved, and the next deployment recovers it', async () => {
      const logger = (await import('../../lib/logger.js')).default;
      const statuses = ready();
      ms.enqueue.mockResolvedValue({ ok: false, value: null, error: new Error('db busy') });

      const engine = await deployAndRecover({ ...DEST, queueMode: 'ALWAYS' });

      expect(statuses).toEqual(new Map([[0, 'TRANSFORMED'], [1, 'RECEIVED']]));
      expect(ms.markProcessed).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        { channelId: CHANNEL_ID, messageId: 7, metaDataId: 1, errMsg: 'db busy' }, expect.stringContaining('the next deployment recovers it'),
      );

      ms.enqueue.mockImplementation(async () => { statuses.set(1, 'QUEUED'); return OK; });
      await engine.undeploy(CHANNEL_ID);
      await engine.deploy(bundleOf(makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [{ ...DEST, queueMode: 'ALWAYS' }] })));
      const next = engine.getRuntime(CHANNEL_ID)!;
      await next.runtime.start();
      await next.recoverOnce();
      expect(statuses).toEqual(new Map([[0, 'SENT'], [1, 'QUEUED']]));
      await engine.dispose();
    });

    it('says so when it was delivered and that could not be saved', async () => {
      const logger = (await import('../../lib/logger.js')).default;
      ready();
      ms.updateConnectorMessageStatus.mockResolvedValueOnce({ ok: false, value: null, error: new Error('db busy') });

      const engine = await deployAndRecover();

      expect(mockSend).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ messageId: 7, metaDataId: 1, what: 'the SENT status of a delivered destination', errMsg: 'db busy' }), expect.stringContaining('could not be saved'),
      );
      await engine.dispose();
    });

    it('goes to its queue without being sent when it always queues', async () => {
      const statuses = ready();

      const engine = await deployAndRecover({ ...DEST, queueMode: 'ALWAYS' });

      expect(mockSend).not.toHaveBeenCalled();
      expect(statuses).toEqual(new Map([[0, 'SENT'], [1, 'QUEUED']]));
      expect(ms.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 7);
      await engine.dispose();
    });
  });

  describe('a message that an earlier deployment is still working on', () => {
    /** The channel deployed again while the first deployment's message 41 is still being sent. */
    async function redeployedDuringASend(): Promise<{
      readonly engine: InstanceType<typeof EngineManager>;
      readonly channel: ReturnType<typeof makeChannel>;
      readonly statuses: ReadonlyMap<number, string>;
      readonly answer: (result: unknown) => void;
      readonly live: Promise<unknown>;
    }> {
      const statuses = new Map<number, string>();
      ms.initializeMessage.mockImplementation(async () => { statuses.set(0, 'RECEIVED'); return ok({ messageId: 41, correlationId: '00000000-0000-0000-0000-000000000041' }); });
      ms.createConnectorMessage.mockImplementation(async (_c: string, _m: number, metaDataId: number, _n: string, status: string) => { statuses.set(metaDataId, status); return OK; });
      ms.updateConnectorMessageStatus.mockImplementation(async (_c: string, _m: number, metaDataId: number, status: string) => { statuses.set(metaDataId, status); return OK; });
      ms.getConnectorMessages.mockImplementation(async () => ok([...statuses].map(([metaDataId, status]) => ({ messageId: 41, metaDataId, status, connectorName: nameOf(metaDataId) }))));
      ms.getLatestMessageId.mockResolvedValue(ok(41));
      let processed = false;
      ms.finalizeMessage.mockImplementation(async () => { processed = true; return OK; });
      ms.markProcessed.mockImplementation(async () => { processed = true; return OK; });
      ms.getUnprocessedMessages.mockImplementation(async () => ok(processed ? [] : [{ id: 41, channelId: CHANNEL_ID }]));
      ms.loadContent.mockImplementation(stored({ [SENT]: 'payload' }));
      let answer: (result: unknown) => void = () => undefined;
      mockSend.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));

      const channel = makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [DEST] });
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(channel));
      const first = engine.getRuntime(CHANNEL_ID)!;
      await first.runtime.start();
      const live = first.processMessage('payload');
      await vi.waitFor(() => { expect(mockSend).toHaveBeenCalledTimes(1); });
      await first.runtime.halt();
      await engine.undeploy(CHANNEL_ID);
      await engine.deploy(bundleOf(channel));
      await engine.getRuntime(CHANNEL_ID)!.runtime.start();
      return { engine, channel, statuses, answer: (result) => { answer(result); }, live };
    }

    it('is not sent a second time by recovery, which waits for it to end', async () => {
      const { engine, answer, live } = await redeployedDuringASend();

      const recovering = engine.getRuntime(CHANNEL_ID)!.recoverOnce();
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      expect(ms.getUnprocessedMessages).not.toHaveBeenCalled();
      answer(ok({ status: 'SENT', content: 'ACK' }));
      await Promise.all([live, recovering]);

      expect(ms.getUnprocessedMessages).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledOnce();
      await engine.dispose();
    });

    it('is recovered once it has ended, when it left a destination unfinished', async () => {
      const { engine, answer, live, statuses } = await redeployedDuringASend();

      const recovering = engine.getRuntime(CHANNEL_ID)!.recoverOnce();
      ms.updateConnectorMessageStatus.mockResolvedValueOnce({ ok: false, value: null, error: new Error('db busy') });
      ms.finalizeMessage.mockResolvedValue({ ok: false, value: null, error: new Error('db busy') });
      answer(ok({ status: 'SENT', content: 'ACK' }));
      await Promise.all([live, recovering]);

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(statuses).toEqual(new Map([[0, 'SENT'], [1, 'SENT']]));
      await engine.dispose();
    });

    it('is said to wait, when it ends on a queue that nothing is sent from', async () => {
      const { engine, answer, live } = await redeployedDuringASend();
      const deployed = engine.getRuntime(CHANNEL_ID)!;
      await deployed.resetClaimsOnce();
      const recovering = deployed.recoverOnce();
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      ms.waitingByDestination.mockResolvedValue(ok([{ metaDataId: 1, waiting: 1, notKnown: 0 }]));

      answer(ok({ status: 'SENT', content: 'ACK' }));
      await Promise.all([live, recovering]);

      expect(mockEmitEvent).toHaveBeenCalledWith(expect.objectContaining({ name: 'QUEUE_HELD', attributes: { metaDataId: 1, waiting: 1, destination: 'Lab', why: 'whose queue is off' } }));
      await engine.dispose();
    });

    it('does not hold up a stop, and the next start waits for it again', async () => {
      const { engine, answer, live } = await redeployedDuringASend();
      const deployed = engine.getRuntime(CHANNEL_ID)!;

      const recovering = deployed.recoverOnce();
      await deployed.runtime.stop();
      await recovering;
      await deployed.runtime.start();
      const again = deployed.recoverOnce();
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      expect(ms.getUnprocessedMessages).not.toHaveBeenCalled();

      answer(ok({ status: 'SENT', content: 'ACK' }));
      await Promise.all([live, again]);
      expect(ms.getUnprocessedMessages).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledOnce();
      await engine.dispose();
    });

    it('is waited for as long as it takes, and said to be, and an alert raised, every 5 minutes', async () => {
      const logger = (await import('../../lib/logger.js')).default;
      const { engine, answer, live } = await redeployedDuringASend();
      const deployed = engine.getRuntime(CHANNEL_ID)!;
      vi.spyOn(deployed.alertManager, 'handleEvent').mockImplementation(async (event) => { alerts(event.errorType, event.errorMessage); });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const recovering = deployed.recoverOnce();
      try {
        await vi.advanceTimersByTimeAsync(299_999);
        expect(logger.error).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(logger.error).toHaveBeenCalledExactlyOnceWith({ channelId: CHANNEL_ID }, expect.stringContaining('recovery is waiting'));
        expect(alerts).toHaveBeenCalledExactlyOnceWith('DESTINATION_CONNECTOR', expect.stringContaining('recovery is waiting'));
        await vi.advanceTimersByTimeAsync(300_000);
        expect(logger.error).toHaveBeenCalledTimes(2);
        expect(ms.getUnprocessedMessages).not.toHaveBeenCalled();
        answer(ok({ status: 'SENT', content: 'ACK' }));
        await vi.advanceTimersByTimeAsync(0);
      } finally {
        vi.useRealTimers();
      }
      await Promise.all([live, recovering]);
      expect(ms.getUnprocessedMessages).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledOnce();
      await engine.dispose();
    });

    it('is waited for when it came while the next deployment was reading which messages were there', async () => {
      const { engine, answer, live, channel } = await redeployedDuringASend();
      const deployed = engine.getRuntime(CHANNEL_ID)!;
      answer(ok({ status: 'SENT', content: 'ACK' }));
      await live;
      let read: (result: unknown) => void = () => undefined;
      ms.getLatestMessageId.mockImplementationOnce(() => new Promise((resolve) => { read = resolve; }));
      let answerLate: (result: unknown) => void = () => undefined;
      mockSend.mockImplementationOnce(() => new Promise((resolve) => { answerLate = resolve; }));
      await deployed.runtime.halt();
      await engine.undeploy(CHANNEL_ID);
      const deploying = engine.deploy(bundleOf(channel));
      await vi.waitFor(() => { expect(ms.getLatestMessageId).toHaveBeenCalledTimes(3); });
      const late = deployed.processMessage('payload');
      await vi.waitFor(() => { expect(mockSend).toHaveBeenCalledTimes(2); });
      read(ok(41));
      await deploying;
      const next = engine.getRuntime(CHANNEL_ID)!;
      await next.runtime.start();

      const recovering = next.recoverOnce();
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      expect(ms.getUnprocessedMessages).not.toHaveBeenCalled();
      answerLate(ok({ status: 'SENT', content: 'ACK' }));
      await Promise.all([late, recovering]);

      expect(mockSend).toHaveBeenCalledTimes(2);
      await engine.dispose();
    });

    it('is waited for by a deployment after the next one too', async () => {
      const { engine, answer, live, channel } = await redeployedDuringASend();
      await engine.undeploy(CHANNEL_ID);
      await engine.deploy(bundleOf(channel));
      const deployed = engine.getRuntime(CHANNEL_ID)!;
      await deployed.runtime.start();

      const recovering = deployed.recoverOnce();
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      expect(ms.getUnprocessedMessages).not.toHaveBeenCalled();
      answer(ok({ status: 'SENT', content: 'ACK' }));
      await Promise.all([live, recovering]);

      expect(mockSend).toHaveBeenCalledOnce();
      await engine.dispose();
    });

    it('an earlier recovery counts as one too', async () => {
      unfinished([0, 'TRANSFORMED'], [1, 'RECEIVED']);
      ms.loadContent.mockImplementation(stored({ [SENT]: 'payload' }));
      let answer: (result: unknown) => void = () => undefined;
      mockSend.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
      const channel = makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [DEST] });
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(channel));
      const first = engine.getRuntime(CHANNEL_ID)!;
      await first.runtime.start();
      const earlier = first.recoverOnce();
      await vi.waitFor(() => { expect(mockSend).toHaveBeenCalledTimes(1); });
      await first.runtime.halt();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const undeployed = engine.undeploy(CHANNEL_ID);
        await vi.advanceTimersByTimeAsync(10_000);
        await undeployed;
      } finally {
        vi.useRealTimers();
      }
      await engine.deploy(bundleOf(channel));
      const second = engine.getRuntime(CHANNEL_ID)!;
      await second.runtime.start();

      const recovering = second.recoverOnce();
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      expect(ms.getUnprocessedMessages).toHaveBeenCalledOnce();
      answer(ok({ status: 'SENT', content: 'ACK' }));
      await Promise.all([earlier, recovering]);

      expect(mockSend).toHaveBeenCalledOnce();
      await engine.dispose();
    });
  });

  describe('a message that was not routed when the server stopped', () => {
    function unrouted(...destinations: readonly number[]): Map<number, string> {
      const statuses = unfinished([0, 'RECEIVED'], ...destinations.map((id) => [id, 'RECEIVED'] as const));
      ms.resetToReceived.mockImplementation(async () => {
        for (const id of destinations) statuses.delete(id);
        return ok({ messageId: 7, correlationId: '00000000-0000-0000-0000-000000000007' });
      });
      ms.createConnectorMessage.mockImplementation(async (_c: string, _m: number, metaDataId: number, _n: string, status: string) => {
        if (statuses.has(metaDataId)) return { ok: false, value: null, error: new Error('duplicate key') };
        statuses.set(metaDataId, status);
        return OK;
      });
      ms.loadContent.mockImplementation(stored({ [RAW]: 'payload' }));
      return statuses;
    }

    it.each([
      ['before its destinations were recorded', []],
      ['after its destinations were recorded', [1]],
    ])('is run again as the same message: %s', async (_when, destinations) => {
      const statuses = unrouted(...destinations);

      const engine = await deployAndRecover();

      expect(ms.resetToReceived).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID, 7);
      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend.mock.calls[0]![0]).toMatchObject({ messageId: 7, metaDataId: 1, content: 'payload', correlationId: '00000000-0000-0000-0000-000000000007' });
      expect(statuses.get(1)).toBe('SENT');
      expect(ms.finalizeMessage).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID, 7, 'test-server');
      // Neither a second message nor a second one received.
      expect(ms.initializeMessage).not.toHaveBeenCalled();
      expect(ms.incrementStats).not.toHaveBeenCalledWith(CHANNEL_ID, 0, 'test-server', expect.anything());
      expect(alerts).not.toHaveBeenCalled();
      await engine.dispose();
    });

    it.each<[string, (contentType: number) => unknown, string]>([
      ['its raw content cannot be read', (t) => (t === RAW ? FAILED : ok(null)), 'cannot decrypt'],
      ['its source map cannot be read', (t) => (t === SOURCE_MAP ? FAILED : ok('payload')), 'cannot decrypt'],
      ['its source map is damaged', (t) => ok(t === SOURCE_MAP ? 'DOE^JANE' : 'payload'), 'not valid JSON'],
    ])('is left as it was, and that is logged, when %s', async (_why, load, errMsg) => {
      const logger = (await import('../../lib/logger.js')).default;
      unrouted();
      ms.loadContent.mockImplementation(async (_c: string, _m: number, _d: number, contentType: number) => load(contentType));

      const engine = await deployAndRecover();

      expect(ms.resetToReceived).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledExactlyOnceWith({ channelId: CHANNEL_ID, messageId: 7, errMsg: expect.stringContaining(errMsg) }, expect.stringContaining('could not run a message again'));
      expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('DOE');
      await engine.dispose();
    });

    describe('and whose raw content is not stored', () => {
      const REASON = expect.stringMatching(/raw content is not stored, so it cannot be run again\. No destination was sent to, but its scripts may have run/) as string;

      beforeEach(() => {
        unrouted(1);
        ms.loadContent.mockResolvedValue(ok(null));
      });

      it('ends in ERROR with the reason, the count and an alert', async () => {
        const logger = (await import('../../lib/logger.js')).default;

        const engine = await deployAndRecover();

        expect(ms.failUnrouted).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID, 7);
        expect(mockSend).not.toHaveBeenCalled();
        expect(ms.resetToReceived).not.toHaveBeenCalled();
        expect(storedFor(0)).toEqual([[PROCESSING_ERROR, REASON]]);
        expect(ms.incrementStats.mock.calls).toEqual([[CHANNEL_ID, 0, 'test-server', 'errored']]);
        expect(alerts).toHaveBeenCalledExactlyOnceWith('SOURCE_CONNECTOR', expect.stringMatching(/marked 1 message\(s\) ERROR \(7\)\. .*raw content is not stored/));
        expect(logger.error).toHaveBeenCalledExactlyOnceWith({ channelId: CHANNEL_ID, messageId: 7, reason: REASON }, expect.stringContaining('marked it ERROR'));
        await engine.dispose();
      });

      it('is one of many: there is one alert for all of them', async () => {
        ms.getUnprocessedMessages.mockResolvedValue(ok(Array.from({ length: 25 }, (_, i) => ({ id: i + 1, channelId: CHANNEL_ID }))));

        const engine = await deployAndRecover();

        expect(ms.failUnrouted).toHaveBeenCalledTimes(25);
        expect(alerts).toHaveBeenCalledExactlyOnceWith('SOURCE_CONNECTOR', expect.stringMatching(/marked 25 message\(s\) ERROR \(1, 2, .*, 20 and more, which the log names\)/));
        await engine.dispose();
      });

      it('is left for the next start, and that is logged, when its end cannot be saved', async () => {
        const logger = (await import('../../lib/logger.js')).default;
        ms.failUnrouted.mockResolvedValue({ ok: false, value: null, error: new Error('db down') });

        const engine = await deployAndRecover();

        expect(storedFor(0)).toEqual([]);
        expect(ms.incrementStats).not.toHaveBeenCalled();
        expect(alerts).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledExactlyOnceWith({ channelId: CHANNEL_ID, messageId: 7, errMsg: 'db down' }, expect.stringContaining('left it as it was'));
        await engine.dispose();
      });

      it('is left for the next start when the channel stops first', async () => {
        let engine: InstanceType<typeof EngineManager> | undefined;
        ms.loadContent.mockImplementation(async () => {
          void engine?.getRuntime(CHANNEL_ID)?.runtime.halt();
          return ok(null);
        });
        engine = new EngineManager('test-server');
        await engine.deploy(bundleOf(makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [DEST] })));
        const deployed = engine.getRuntime(CHANNEL_ID)!;
        await deployed.runtime.start();

        await deployed.recoverOnce();

        expect(ms.failUnrouted).not.toHaveBeenCalled();
        await engine.dispose();
      });

      it.each([
        ['its reason', 'storeContent', 'why a message failed'],
        ['its count', 'incrementStats', 'the count of a failed message'],
      ] as const)('ends in ERROR all the same, and the log says so, when %s cannot be saved', async (_what, write, what) => {
        const logger = (await import('../../lib/logger.js')).default;
        ms[write].mockResolvedValue({ ok: false, value: null, error: new Error('db down') });

        const engine = await deployAndRecover();

        expect(ms.failUnrouted).toHaveBeenCalledOnce();
        expect(alerts).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ messageId: 7, what, errMsg: 'db down' }), expect.stringContaining('could not be saved'));
        await engine.dispose();
      });
    });

    it('is run with the source map stored for it', async () => {
      unrouted();
      ms.loadContent.mockImplementation(stored({ [RAW]: 'payload', [SOURCE_MAP]: '{"file":"a.txt"}' }));

      const engine = await deployAndRecover({ ...DEST, properties: { template: '${file}' } });

      expect(mockSend.mock.calls[0]![0]).toMatchObject({ content: 'a.txt' });
      await engine.dispose();
    });

    it('is not run, and that is logged, when it cannot be put back as it was received', async () => {
      const logger = (await import('../../lib/logger.js')).default;
      unrouted();
      ms.resetToReceived.mockResolvedValue({ ok: false, value: null, error: new Error('it has been routed') });

      const engine = await deployAndRecover();

      expect(mockSend).not.toHaveBeenCalled();
      expect(ms.markProcessed).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledExactlyOnceWith({ channelId: CHANNEL_ID, messageId: 7, errMsg: 'it has been routed' }, expect.stringContaining('could not run a message again'));
      await engine.dispose();
    });

    it.each(['stop', 'halt'] as const)('is not run when a %s comes while it is put back, but after the next start', async (action) => {
      unrouted();
      let reset: (result: unknown) => void = () => undefined;
      ms.resetToReceived.mockImplementationOnce(() => new Promise((resolve) => { reset = resolve; }));
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [DEST] })));
      const deployed = engine.getRuntime(CHANNEL_ID)!;
      await deployed.runtime.start();
      const done = deployed.recoverOnce();
      await vi.waitFor(() => { expect(ms.resetToReceived).toHaveBeenCalledOnce(); });

      const ended = deployed.runtime[action]();
      reset(ok({ messageId: 7, correlationId: '00000000-0000-0000-0000-000000000007' }));
      await Promise.all([done, ended]);
      expect(mockSend).not.toHaveBeenCalled();
      expect(ms.markProcessed).not.toHaveBeenCalled();

      await deployed.runtime.start();
      await deployed.recoverOnce();
      expect(mockSend).toHaveBeenCalledOnce();
      await engine.dispose();
    });

    it('is run once when the channel is deployed again while it is being run', async () => {
      unrouted();
      let record: (result: unknown) => void = () => undefined;
      ms.createConnectorMessage.mockImplementationOnce(() => new Promise((resolve) => { record = resolve; }));
      let finished = false;
      ms.finalizeMessage.mockImplementation(async () => { finished = true; return OK; });
      ms.getUnprocessedMessages.mockImplementation(async () => ok(finished ? [] : [{ id: 7, channelId: CHANNEL_ID }]));
      const channel = makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [DEST] });
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(channel));
      const first = engine.getRuntime(CHANNEL_ID)!;
      await first.runtime.start();
      const earlier = first.recoverOnce();
      await vi.waitFor(() => { expect(ms.createConnectorMessage).toHaveBeenCalledOnce(); });
      await first.runtime.halt();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const undeployed = engine.undeploy(CHANNEL_ID);
        await vi.advanceTimersByTimeAsync(10_000);
        await undeployed;
      } finally {
        vi.useRealTimers();
      }
      await engine.deploy(bundleOf(channel));
      const second = engine.getRuntime(CHANNEL_ID)!;
      await second.runtime.start();

      const recovering = second.recoverOnce();
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      expect(ms.getUnprocessedMessages).toHaveBeenCalledOnce();
      record(OK);
      await Promise.all([earlier, recovering]);

      expect(ms.resetToReceived).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledOnce();
      expect(ms.updateConnectorMessageStatus).not.toHaveBeenCalledWith(CHANNEL_ID, 7, expect.anything(), 'ERROR', undefined);
      await engine.dispose();
    });
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
      .mockResolvedValueOnce(ok([{ messageId: 8, metaDataId: 0, status: 'TRANSFORMED', connectorName: 'Source' }, { messageId: 8, metaDataId: 1, status: 'RECEIVED', connectorName: 'Lab' }]))
      .mockResolvedValue(ok([{ messageId: 8, metaDataId: 0, status: 'TRANSFORMED', connectorName: 'Source' }, { messageId: 8, metaDataId: 1, status: 'SENT', connectorName: 'Lab' }]));
    ms.loadContent.mockImplementation(stored({ [SENT]: 'ready to send' }));

    const engine = await deployAndRecover();

    expect(ms.updateConnectorMessageStatus).toHaveBeenCalledWith(CHANNEL_ID, 8, 0, 'SENT', undefined);
    expect(ms.incrementStats).toHaveBeenCalledWith(CHANNEL_ID, 0, 'test-server', 'sent');
    expect(ms.markProcessed).toHaveBeenCalledWith(CHANNEL_ID, 8);
    await engine.dispose();
  });

  describe('interrupted by a stop', () => {
    const READY = { messageId: 7, metaDataId: 1, status: 'RECEIVED', connectorName: 'Lab' };

    /** A channel with one message to send again, whose send ends only when it is told how, or is aborted. */
    async function recovering({ ignoresItsSignal = false } = {}): Promise<{
      readonly engine: InstanceType<typeof EngineManager>;
      readonly deployed: NonNullable<ReturnType<InstanceType<typeof EngineManager>['getRuntime']>>;
      readonly done: Promise<void>;
      readonly answer: (result: unknown) => void;
      readonly destinationStop: ReturnType<typeof vi.fn>;
    }> {
      ms.getUnprocessedMessages.mockResolvedValue(ok([{ id: 7, channelId: CHANNEL_ID }]));
      ms.getConnectorMessages.mockResolvedValue(ok([{ messageId: 7, metaDataId: 0, status: 'TRANSFORMED', connectorName: 'Source' }, READY]));
      ms.loadContent.mockImplementation(stored({ [SENT]: 'payload' }));
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

    it('a send has the five minutes a direct send has', async () => {
      const expiry = new AbortController();
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(expiry.signal);
      try {
        const { engine, done } = await recovering();
        expect(timeout).toHaveBeenCalledExactlyOnceWith(300_000);
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
      expect(logger.error).toHaveBeenCalledWith({ channelId: CHANNEL_ID }, expect.stringContaining('still sending'));
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
      ms.getConnectorMessages.mockResolvedValue(ok([{ messageId: 7, metaDataId: 0, status: 'TRANSFORMED', connectorName: 'Source' }, READY]));
      let loaded: (result: unknown) => void = () => undefined;
      ms.loadContent.mockImplementationOnce(() => new Promise((resolve) => { loaded = resolve; }));
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [DEST] })));
      const deployed = engine.getRuntime(CHANNEL_ID)!;
      await deployed.runtime.start();
      const done = deployed.recoverOnce();
      await vi.waitFor(() => { expect(ms.loadContent).toHaveBeenCalledOnce(); });

      const logger = (await import('../../lib/logger.js')).default;
      const ended = deployed.runtime[action]();
      loaded(ok('payload'));
      await Promise.all([done, ended]);
      expect(mockSend).not.toHaveBeenCalled();
      expect(ms.updateConnectorMessageStatus).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();

      ms.loadContent.mockImplementation(stored({ [SENT]: 'payload' }));
      await deployed.runtime.start();
      await deployed.recoverOnce();
      expect(mockSend).toHaveBeenCalledOnce();
      await engine.dispose();
    });

    it.each(['stop', 'halt'] as const)('a message to run again is not run on a channel that a %s has stopped, but after the next start', async (action) => {
      ms.getUnprocessedMessages.mockResolvedValue(ok([{ id: 7, channelId: CHANNEL_ID }]));
      ms.getConnectorMessages.mockResolvedValue(ok([{ messageId: 7, metaDataId: 0, status: 'RECEIVED', connectorName: 'Source' }]));
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
      expect(ms.resetToReceived).not.toHaveBeenCalled();
      expect(ms.markProcessed).not.toHaveBeenCalled();

      ms.loadContent.mockImplementation(stored({ [RAW]: 'payload' }));
      ms.resetToReceived.mockResolvedValue(ok({ messageId: 7, correlationId: '00000000-0000-0000-0000-000000000007' }));
      await deployed.runtime.start();
      await deployed.recoverOnce();
      expect(mockSend).toHaveBeenCalledOnce();
      await engine.dispose();
    });
  });

  it('a message routed to a queued destination that uses variables has that kept, for recovery to go by', async () => {
    mockVariablesUsed.mockReturnValue(['mrn']);
    const engine = await deployAndRecover({ ...DEST, queueMode: 'ALWAYS' });

    await engine.getRuntime(CHANNEL_ID)!.processMessage('x');

    expect(storedFor(1)).toContainEqual([VARIABLES, '{}']);
    await engine.dispose();
  });

  it('keeps nothing of a message or a recovery once it has ended', async () => {
    const engine = await deployAndRecover();
    await engine.getRuntime(CHANNEL_ID)!.processMessage('x');
    await new Promise((resolve) => { setImmediate(resolve); });

    const { working } = engine as unknown as { readonly working: ReadonlyMap<string, ReadonlySet<unknown>> };
    expect(working.get(CHANNEL_ID)).toEqual(new Set());
    await engine.dispose();
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

  it('releases stale queue claims once, separately from recovery, also of destinations it no longer has', async () => {
    ms.waitingByDestination.mockResolvedValue(ok([{ metaDataId: 1, waiting: 1 }, { metaDataId: 4, waiting: 1 }]));
    const engine = new EngineManager('test-server');
    await engine.deploy(bundleOf(makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [{ ...DEST, queueMode: 'ALWAYS' }] })));
    const deployed = engine.getRuntime(CHANNEL_ID)!;

    await deployed.resetClaimsOnce();
    await deployed.resetClaimsOnce();
    await deployed.runtime.start();
    await deployed.recoverOnce();

    expect(ms.resetPending.mock.calls).toEqual([[CHANNEL_ID, 1], [CHANNEL_ID, 4]]);
    await engine.dispose();
  });

  it('releases the claims of its own destinations when it cannot read where messages wait', async () => {
    ms.waitingByDestination.mockResolvedValue({ ok: false, value: null, error: new Error('db busy') });
    const engine = new EngineManager('test-server');
    await engine.deploy(bundleOf(makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [DEST] })));

    await engine.getRuntime(CHANNEL_ID)!.resetClaimsOnce();

    expect(ms.resetPending.mock.calls).toEqual([[CHANNEL_ID, 1]]);
    await engine.dispose();
  });

  it('says once, with one alert, which messages wait on a queue that does not send them, and why', async () => {
    const logger = (await import('../../lib/logger.js')).default;
    ms.waitingByDestination.mockResolvedValue(ok([1, 2, 3, 4, 5].map((metaDataId) => ({ metaDataId, waiting: metaDataId + 1, notKnown: metaDataId === 5 ? 2 : 0 }))));
    const queues = { ...DEST, queueMode: 'ALWAYS' };
    const engine = new EngineManager('test-server');
    await engine.deploy(bundleOf(makeChannel({
      inboundDataType: 'RAW', outboundDataType: 'RAW',
      destinations: [queues, { ...queues, id: 'd2', metaDataId: 2, name: 'Clinic', enabled: false }, { ...DEST, id: 'd3', metaDataId: 3, name: 'Ward' }, { ...queues, id: 'd5', metaDataId: 5, name: 'Archive' }],
    })));
    const deployed = engine.getRuntime(CHANNEL_ID)!;
    vi.spyOn(deployed.alertManager, 'handleEvent').mockImplementation(async (event) => { alerts(event.errorType, event.errorMessage); });
    ms.getUnprocessedMessages.mockResolvedValueOnce({ ok: false, value: null, error: new Error('db gone') });

    await deployed.runtime.start();
    await deployed.recoverOnce();
    expect(mockEmitEvent).not.toHaveBeenCalled();
    await deployed.recoverOnce();

    expect(ms.getUnprocessedMessages).toHaveBeenCalledTimes(2);
    expect(ms.waitingByDestination.mock.invocationCallOrder[0]!).toBeGreaterThan(ms.getUnprocessedMessages.mock.invocationCallOrder[0]!);
    const old ='put there before destinations kept their numbers, so it is not known that they are for it';
    expect(alerts.mock.calls).toEqual([['DESTINATION_CONNECTOR', 'Messages wait on a queue and are kept, not sent: '
      + `3 for "Clinic", which is switched off; 4 for "Ward", whose queue is off; 5 for destination 4, which the channel no longer has; 2 for "Archive", ${old}`]]);
    const held = [
      { metaDataId: 2, waiting: 3, destination: 'Clinic', why: 'which is switched off' },
      { metaDataId: 3, waiting: 4, destination: 'Ward', why: 'whose queue is off' },
      { metaDataId: 4, waiting: 5, destination: null, why: 'which the channel no longer has' },
      { metaDataId: 5, waiting: 2, destination: 'Archive', why: old },
    ];
    expect(vi.mocked(logger.error).mock.calls.map(([about]) => about).filter((about) => (about as Record<string, unknown>)['waiting'] !== undefined))
      .toEqual(held.map(({ destination: _d, ...about }) => ({ channelId: CHANNEL_ID, ...about })));
    expect(mockEmitEvent.mock.calls.map(([event]) => [event.name, event.level, event.attributes])).toEqual(held.map((about) => ['QUEUE_HELD', 'WARN', about]));
    await engine.dispose();
  });

  it('recovers when it cannot read which queues messages wait on, says so in the log, and reads it at the next start', async () => {
    const logger = (await import('../../lib/logger.js')).default;
    ms.waitingByDestination.mockResolvedValue({ ok: false, value: null, error: new Error('db busy') });

    const engine = await deployAndRecover();

    expect(logger.error).toHaveBeenCalledWith({ channelId: CHANNEL_ID, errMsg: 'db busy' }, 'Could not read whether messages wait on a queue that nothing is sent from');
    expect(ms.getUnprocessedMessages).toHaveBeenCalledOnce();

    ms.waitingByDestination.mockResolvedValue(ok([{ metaDataId: 1, waiting: 1, notKnown: 0 }]));
    const deployed = engine.getRuntime(CHANNEL_ID)!;
    await deployed.runtime.stop();
    await deployed.runtime.start();
    await deployed.recoverOnce();

    expect(mockEmitEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'QUEUE_HELD' }));
    expect(ms.getUnprocessedMessages).toHaveBeenCalledOnce();
    await engine.dispose();
  });
});
