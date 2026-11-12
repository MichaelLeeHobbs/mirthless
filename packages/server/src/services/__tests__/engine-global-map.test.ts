// ===========================================
// Engine Global Map Tests
// ===========================================
// The global map is one map shared by every deployed channel. These tests use
// the real engine package and fake only the database, the services that read
// it and the connectors that open sockets.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock Dependencies -----

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
    send: vi.fn().mockResolvedValue({ ok: true, value: { status: 'SENT', content: '' }, error: null }),
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

vi.mock('../message.service.js', () => ({
  MessageService: {
    initializeMessage: vi.fn().mockResolvedValue({ ok: true, value: { messageId: 1, correlationId: '00000000-0000-0000-0000-000000000099' }, error: null }),
    finalizeMessage: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    storeAttachment: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    createMessage: vi.fn().mockResolvedValue({ ok: true, value: { messageId: 1, correlationId: '00000000-0000-0000-0000-000000000099' }, error: null }),
    createConnectorMessage: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    updateConnectorMessageStatus: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    storeContent: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    markProcessed: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    enqueue: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    loadContent: vi.fn().mockResolvedValue({ ok: true, value: null, error: null }),
    incrementStats: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    dequeue: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
    release: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    deleteContent: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    deleteAttachments: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    resetPending: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    getUnprocessedMessages: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
    getLatestMessageId: vi.fn().mockResolvedValue({ ok: true, value: 0, error: null }),
    getConnectorMessages: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
  },
}));

const mockGlobalMapList = vi.fn();
const mockPersist = vi.fn();
const mockPersistRemoval = vi.fn();
type Change = { type: 'set'; row: { key: string; value: string | null; isJson: boolean } } | { type: 'delete'; key: string } | { type: 'clear' };
let changeListener: ((change: Change) => void) | null = null;
vi.mock('../global-map.service.js', () => ({
  GlobalMapService: {
    list: mockGlobalMapList,
    persist: mockPersist,
    persistRemoval: mockPersistRemoval,
    onChange: (listener: (change: Change) => void): void => { changeListener = listener; },
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
    metadataColumns: [],
    destinations: [],
    scripts: [],
    ...overrides,
  } as never;
}

const OTHER_ID = '00000000-0000-0000-0000-000000000002';
const OK = { ok: true, value: undefined, error: null };

function scripted(id: string, name: string, preprocessor: string): never {
  return makeChannel({ id, name, inboundDataType: 'RAW', outboundDataType: 'RAW', scripts: [{ scriptType: 'PREPROCESSOR', script: preprocessor }] });
}

async function run(engine: InstanceType<typeof EngineManager>, id: string, raw: string): Promise<void> {
  const result = await engine.getRuntime(id)!.processMessage(raw);
  expect(result.ok ? 'ok' : result.error.message).toBe('ok');
}

beforeEach(() => {
  vi.clearAllMocks();
  changeListener = null;
  mockSelect.mockImplementation(() => ({ from: () => ({ leftJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }) }) }));
  mockListTemplates.mockResolvedValue(OK_EMPTY);
  mockConfigMapList.mockResolvedValue(OK_EMPTY);
  mockGlobalMapList.mockResolvedValue(OK_EMPTY);
  mockPersist.mockResolvedValue(OK);
  mockPersistRemoval.mockResolvedValue(OK);
});

describe('EngineManager global map', () => {
  it('lets one channel read what another channel stored', async () => {
    const engine = new EngineManager('test-server');
    await engine.deploy(scripted(CHANNEL_ID, 'Writer', 'globalMap["site"] = { code: "0042" }; return msg;'));
    await engine.deploy(scripted(OTHER_ID, 'Reader', 'globalChannelMap["seen"] = globalMap["site"] ? globalMap["site"].code : "missing"; return msg;'));

    await run(engine, CHANNEL_ID, 'a');
    await run(engine, OTHER_ID, 'b');

    expect(engine.getRuntime(OTHER_ID)!.globalChannelMap.get('seen')).toBe('0042');
    expect(mockGlobalMapList).toHaveBeenCalledTimes(1);
    await engine.dispose();
  });

  it('saves script values with their type, and plain text as text', async () => {
    const engine = new EngineManager('test-server');
    await engine.deploy(scripted(CHANNEL_ID, 'Writer', 'globalMap["count"] = 7; globalMap["zip"] = "00501"; globalMap["o"] = { a: 1 }; return msg;'));
    await run(engine, CHANNEL_ID, 'a');
    await engine.undeploy(CHANNEL_ID);

    expect(mockPersist).toHaveBeenCalledWith('count', '7', true);
    expect(mockPersist).toHaveBeenCalledWith('zip', '00501', false);
    expect(mockPersist).toHaveBeenCalledWith('o', '{"a":1}', true);
    await engine.dispose();
  });

  it('loads stored JSON values back with their type', async () => {
    mockGlobalMapList.mockResolvedValue({ ok: true, value: [{ key: 'count', value: '7', isJson: true }, { key: 'zip', value: '00501', isJson: false }], error: null });
    const engine = new EngineManager('test-server');
    await engine.deploy(scripted(CHANNEL_ID, 'Reader', 'globalChannelMap["sum"] = globalMap["count"] + 1; globalChannelMap["zip"] = globalMap["zip"]; return msg;'));
    await run(engine, CHANNEL_ID, 'a');

    const gcm = engine.getRuntime(CHANNEL_ID)!.globalChannelMap;
    expect(gcm.get('sum')).toBe(8);
    expect(gcm.get('zip')).toBe('00501');
    await engine.dispose();
  });

  it('removes a key from the database when a script deletes it', async () => {
    mockGlobalMapList.mockResolvedValue({ ok: true, value: [{ key: 'old', value: 'x', isJson: false }], error: null });
    const engine = new EngineManager('test-server');
    await engine.deploy(scripted(CHANNEL_ID, 'Cleaner', 'delete globalMap["old"]; return msg;'));
    await run(engine, CHANNEL_ID, 'a');
    await engine.dispose();

    expect(mockPersistRemoval).toHaveBeenCalledWith('old');
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it('shows running channels an edit made through the API', async () => {
    const engine = new EngineManager('test-server');
    await engine.deploy(scripted(CHANNEL_ID, 'Reader', 'globalChannelMap["seen"] = globalMap["mode"]; return msg;'));
    expect(changeListener).not.toBeNull();

    changeListener!({ type: 'set', row: { key: 'mode', value: 'maintenance', isJson: false } });
    await run(engine, CHANNEL_ID, 'a');
    expect(engine.getRuntime(CHANNEL_ID)!.globalChannelMap.get('seen')).toBe('maintenance');

    changeListener!({ type: 'delete', key: 'mode' });
    await run(engine, CHANNEL_ID, 'b');
    expect(engine.getRuntime(CHANNEL_ID)!.globalChannelMap.containsKey('seen')).toBe(false);

    changeListener!({ type: 'set', row: { key: 'mode', value: 'x', isJson: false } });
    changeListener!({ type: 'clear' });
    await run(engine, CHANNEL_ID, 'c');
    expect(engine.getRuntime(CHANNEL_ID)!.globalChannelMap.containsKey('seen')).toBe(false);
    await engine.dispose();
  });

  it('keeps the map across an undeploy of one channel', async () => {
    const engine = new EngineManager('test-server');
    await engine.deploy(scripted(CHANNEL_ID, 'Writer', 'globalMap["k"] = "v"; return msg;'));
    await engine.deploy(scripted(OTHER_ID, 'Reader', 'globalChannelMap["seen"] = globalMap["k"]; return msg;'));
    await run(engine, CHANNEL_ID, 'a');
    await engine.undeploy(CHANNEL_ID);
    await run(engine, OTHER_ID, 'b');

    expect(engine.getRuntime(OTHER_ID)!.globalChannelMap.get('seen')).toBe('v');
    await engine.dispose();
  });

  it('logs a failed save and saves again on the next flush', async () => {
    const logger = (await import('../../lib/logger.js')).default;
    mockPersist.mockResolvedValueOnce({ ok: false, value: null, error: new Error('db down') });
    const engine = new EngineManager('test-server');
    await engine.deploy(scripted(CHANNEL_ID, 'Writer', 'globalMap["k"] = "v"; return msg;'));
    await run(engine, CHANNEL_ID, 'a');
    await engine.undeploy(CHANNEL_ID);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ key: 'k', errMsg: 'db down' }), expect.stringContaining('global map'));

    await engine.dispose();
    expect(mockPersist).toHaveBeenCalledTimes(2);
  });
});
