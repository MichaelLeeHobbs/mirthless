// ===========================================
// Engine Script Timeout Tests
// ===========================================
// The channel's script timeout limits each script, not the whole message, and
// never cuts a destination send short. Real engine package; fake database,
// services and connectors.

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
    getConnectorMessages: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
  },
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockImplementation(() => ({ from: () => ({ leftJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }) }) }));
  mockListTemplates.mockResolvedValue(OK_EMPTY);
  mockConfigMapList.mockResolvedValue(OK_EMPTY);
  mockGlobalMapList.mockResolvedValue(OK_EMPTY);
  mockPersist.mockResolvedValue(OK);
  mockPersistRemoval.mockResolvedValue(OK);
});

describe('EngineManager script timeout', () => {
  it('stops a runaway script at the channel script timeout, not the 30 second default', async () => {
    const engine = new EngineManager('test-server');
    await engine.deploy(makeChannel({
      inboundDataType: 'RAW', outboundDataType: 'RAW', scriptTimeoutSeconds: 1,
      scripts: [{ scriptType: 'PREPROCESSOR', script: 'while (true) {}' }],
    }));
    const started = Date.now();

    const result = await engine.getRuntime(CHANNEL_ID)!.processMessage('x');

    expect(Date.now() - started).toBeLessThan(3_000);
    expect(result.ok && result.value.status).toBe('ERROR');
    await engine.dispose();
  }, 10_000);

  it('does not cut short a destination that takes longer than the script timeout', async () => {
    mockSend.mockImplementation((_msg: unknown, signal: AbortSignal) => new Promise((resolve) => {
      const timer = setTimeout(() => { resolve({ ok: true, value: { status: 'SENT', content: 'ACK' }, error: null }); }, 1_300);
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve({ ok: false, value: null, error: new Error('aborted') }); });
    }));
    const engine = new EngineManager('test-server');
    await engine.deploy(makeChannel({
      inboundDataType: 'RAW', outboundDataType: 'RAW', scriptTimeoutSeconds: 1, responseMode: 'AUTO_AFTER_DESTINATIONS',
      destinations: [{ id: 'd1', metaDataId: 1, name: 'Slow', enabled: true, connectorType: 'HTTP', properties: {}, queueMode: 'NEVER' }],
    }));
    const runtime = engine.getRuntime(CHANNEL_ID)!;
    await runtime.runtime.start();

    const result = await runtime.processMessage('x');

    expect(result.ok && result.value.status).toBe('PROCESSED');
    await engine.dispose();
  }, 10_000);
});
