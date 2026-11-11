// ===========================================
// Engine Recovery Tests
// ===========================================
// What a channel does on its first start with messages an earlier run left
// unfinished. Real engine package; fake database, services and connectors.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock Dependencies -----

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@galvaniflow/connectors', () => ({
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

const mockListTemplates = vi.fn();
vi.mock('../code-template.service.js', () => ({
  CodeTemplateService: { listTemplates: mockListTemplates },
}));

const mockGlobalScriptGetAll = vi.fn().mockResolvedValue({
  ok: true, value: { deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }, error: null,
});

vi.mock('../global-script.service.js', () => ({
  GlobalScriptService: {
    getAll: mockGlobalScriptGetAll,
  },
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

// Deploy reads filter rules and transformer steps; these channels have none.
const mockSelect = vi.fn();

vi.mock('../../lib/db.js', () => ({
  db: { select: mockSelect },
}));

vi.mock('../../db/schema/index.js', () => ({
  channelFilters: { id: 'id', channelId: 'channelId', connectorId: 'connectorId' },
  filterRules: { id: 'id', filterId: 'filterId', sequenceNumber: 'sequenceNumber', enabled: 'enabled', operator: 'operator', type: 'type', script: 'script' },
  channelTransformers: { id: 'id', channelId: 'channelId', connectorId: 'connectorId' },
  transformerSteps: { id: 'id', transformerId: 'transformerId', sequenceNumber: 'sequenceNumber', enabled: 'enabled', type: 'type', script: 'script' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  asc: vi.fn(),
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

// ----- Fixtures -----

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
    destinations: [],
    scripts: [],
    ...overrides,
  } as never;
}

const OK = { ok: true, value: undefined, error: null };
const ok = <T>(value: T): { ok: true; value: T; error: null } => ({ ok: true, value, error: null });
const DEST = { id: 'd1', metaDataId: 1, name: 'Lab', enabled: true, connectorType: 'HTTP', properties: {}, queueMode: 'NEVER' };

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockImplementation(() => ({ from: () => ({ leftJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }) }) }));
  mockListTemplates.mockResolvedValue(OK_EMPTY);
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
  await engine.deploy(makeChannel({ inboundDataType: 'RAW', outboundDataType: 'RAW', destinations: [DEST] }));
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

    expect(ms.getUnprocessedMessages).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ channelId: CHANNEL_ID, errMsg: 'db down' }), expect.stringContaining('recovery'));
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
});
