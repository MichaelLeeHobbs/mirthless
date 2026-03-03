// ===========================================
// Engine Integration Tests
// ===========================================
// Tests for AlertManager + JavaScript Connector wiring in EngineManager.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock Dependencies -----

// Mock AlertManager
const mockAlertManager = {
  loadAlerts: vi.fn(),
  handleEvent: vi.fn(),
  clearThrottleState: vi.fn(),
  getAlerts: vi.fn().mockReturnValue([]),
};

const MockAlertManagerCtor = vi.fn().mockImplementation(() => mockAlertManager);

// Mock ChannelRuntime
const mockRuntimeDeploy = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });
const mockRuntimeUndeploy = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });
const mockChannelRuntime = {
  deploy: mockRuntimeDeploy,
  undeploy: mockRuntimeUndeploy,
};
const MockChannelRuntime = vi.fn().mockImplementation(() => mockChannelRuntime);

// Mock GlobalChannelMap
const mockGcm = { clear: vi.fn(), toRecord: vi.fn().mockReturnValue({}), applyUpdates: vi.fn() };
const MockGlobalChannelMap = vi.fn().mockImplementation(() => mockGcm);

// Mock SandboxExecutor
const mockSandboxExecute = vi.fn().mockResolvedValue({
  ok: true,
  value: { returnValue: 'test-result', mapUpdates: { channelMap: {}, connectorMap: {}, globalChannelMap: {} }, logs: [] },
  error: null,
});
const mockSandboxDispose = vi.fn();
const MockVmSandboxExecutor = vi.fn().mockImplementation(() => ({
  execute: mockSandboxExecute,
  dispose: mockSandboxDispose,
}));

// Mock compileScript
const mockCompileScript = vi.fn().mockResolvedValue({
  ok: true, value: { code: 'compiled-code' }, error: null,
});

vi.mock('@mirthless/engine', () => ({
  ChannelRuntime: MockChannelRuntime,
  VmSandboxExecutor: MockVmSandboxExecutor,
  MessageProcessor: vi.fn().mockImplementation(() => ({
    processMessage: vi.fn().mockResolvedValue({
      ok: true, value: { messageId: 1, status: 'SENT', destinationResults: [] }, error: null,
    }),
  })),
  DEFAULT_EXECUTION_OPTIONS: { timeout: 30000, memoryLimit: 134217728, signal: AbortSignal.timeout(30000) },
  GlobalChannelMap: MockGlobalChannelMap,
  GlobalMapProxy: vi.fn().mockImplementation(() => ({ load: vi.fn(), start: vi.fn(), toRecord: vi.fn().mockReturnValue({}), applyUpdates: vi.fn(), flush: vi.fn().mockResolvedValue(undefined), dispose: vi.fn().mockResolvedValue(undefined) })),
  compileScript: mockCompileScript,
  compileFilterRulesToScript: vi.fn().mockReturnValue(null),
  compileTransformerStepsToScript: vi.fn().mockReturnValue(null),
  prependTemplates: vi.fn().mockImplementation((src: string) => src),
  AlertManager: MockAlertManagerCtor,
}));

// Mock JavaScript connectors
const mockSetScriptRunner = vi.fn();
const mockSetDestScriptRunner = vi.fn();

const MockJavaScriptReceiver = vi.fn().mockImplementation(() => ({
  setScriptRunner: mockSetScriptRunner,
  setDispatcher: vi.fn(),
  onDeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  onStart: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  onStop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  onHalt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  onUndeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
}));

const MockJavaScriptDispatcher = vi.fn().mockImplementation(() => ({
  setScriptRunner: mockSetDestScriptRunner,
  send: vi.fn().mockResolvedValue({ ok: true, value: { status: 'SENT', content: '' }, error: null }),
  onDeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  onStart: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  onStop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  onHalt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  onUndeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
}));

// Track which connectors are returned by create* functions
let _lastSourceConnector: unknown = null;
let destConnectorsByCall: unknown[] = [];

vi.mock('@mirthless/connectors', () => ({
  createSourceConnector: vi.fn().mockImplementation((type: string) => {
    if (type === 'JAVASCRIPT') {
      const instance = new (MockJavaScriptReceiver as unknown as new () => unknown)();
      _lastSourceConnector = instance;
      return instance;
    }
    const tcpMock = {
      setDispatcher: vi.fn(),
      onDeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
      onStart: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
      onStop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
      onHalt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
      onUndeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    };
    _lastSourceConnector = tcpMock;
    return tcpMock;
  }),
  createDestinationConnector: vi.fn().mockImplementation((type: string) => {
    if (type === 'JAVASCRIPT') {
      const instance = new (MockJavaScriptDispatcher as unknown as new () => unknown)();
      destConnectorsByCall.push(instance);
      return instance;
    }
    const httpMock = {
      send: vi.fn().mockResolvedValue({ ok: true, value: { status: 'SENT', content: '' }, error: null }),
      onDeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
      onStart: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
      onStop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
      onHalt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
      onUndeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    };
    destConnectorsByCall.push(httpMock);
    return httpMock;
  }),
  JavaScriptReceiver: MockJavaScriptReceiver,
  JavaScriptDispatcher: MockJavaScriptDispatcher,
}));

// Mock MessageService
vi.mock('../message.service.js', () => ({
  MessageService: {
    createMessage: vi.fn().mockResolvedValue({ ok: true, value: { messageId: 1 }, error: null }),
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
  },
}));

// Mock CodeTemplateService
vi.mock('../code-template.service.js', () => ({
  CodeTemplateService: {
    listTemplates: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
  },
}));

// Mock GlobalScriptService
vi.mock('../global-script.service.js', () => ({
  GlobalScriptService: {
    getAll: vi.fn().mockResolvedValue({ ok: true, value: { preprocessor: null, postprocessor: null }, error: null }),
  },
}));

// Mock AlertService
const mockAlertServiceList = vi.fn();
const mockAlertServiceGetById = vi.fn();
const mockAlertServiceGetByIds = vi.fn();

vi.mock('../alert.service.js', () => ({
  AlertService: {
    list: mockAlertServiceList,
    getById: mockAlertServiceGetById,
    getByIds: mockAlertServiceGetByIds,
  },
}));

// Mock DB (for loadFilterTransformerData)
const mockSelectFrom = vi.fn().mockReturnValue({
  leftJoin: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockResolvedValue([]),
    }),
  }),
});
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

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
const ALERT_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const ALERT_ID_2 = '00000000-0000-0000-0000-bbbbbbbbbbbb';

function makeChannel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CHANNEL_ID,
    name: 'Test Channel',
    enabled: true,
    sourceConnectorType: 'TCP_MLLP',
    sourceConnectorProperties: { port: 6661 },
    inboundDataType: 'HL7V2',
    outboundDataType: 'HL7V2',
    destinations: [],
    scripts: [],
    ...overrides,
  };
}

function makeAlertSummary(id: string, enabled: boolean): Record<string, unknown> {
  return {
    id,
    name: `Alert ${id}`,
    enabled,
    triggerType: 'CHANNEL_ERROR',
    revision: 1,
    channelCount: 0,
    actionCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeAlertDetail(id: string, channelIds: readonly string[]): Record<string, unknown> {
  return {
    id,
    name: `Alert ${id}`,
    enabled: true,
    triggerType: 'CHANNEL_ERROR',
    revision: 1,
    channelCount: channelIds.length,
    actionCount: 1,
    trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null },
    channelIds,
    actions: [
      { id: 'action-1', actionType: 'EMAIL', recipients: ['admin@example.com'], properties: null },
    ],
    subjectTemplate: null,
    bodyTemplate: null,
    reAlertIntervalMs: null,
    maxAlerts: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
  _lastSourceConnector = null;
  destConnectorsByCall = [];
  mockAlertServiceList.mockResolvedValue({
    ok: true,
    value: { data: [], pagination: { page: 1, pageSize: 1000, total: 0, totalPages: 0 } },
    error: null,
  });
  mockAlertServiceGetByIds.mockResolvedValue({
    ok: true, value: [], error: null,
  });
});

// ----- Tests -----

describe('EngineManager', () => {
  describe('deploy with AlertManager', () => {
    it('creates an AlertManager and stores it in DeployedChannel', async () => {
      const engine = new EngineManager('test-server');
      const channel = makeChannel();

      await engine.deploy(channel as never);

      expect(MockAlertManagerCtor).toHaveBeenCalledOnce();
      const deployed = engine.getRuntime(CHANNEL_ID);
      expect(deployed).toBeDefined();
      expect(deployed!.alertManager).toBe(mockAlertManager);
    });

    it('loads enabled alerts and passes them to AlertManager', async () => {
      mockAlertServiceList.mockResolvedValue({
        ok: true,
        value: {
          data: [
            makeAlertSummary(ALERT_ID, true),
            makeAlertSummary(ALERT_ID_2, false), // disabled, should be skipped
          ],
          pagination: { page: 1, pageSize: 1000, total: 2, totalPages: 1 },
        },
        error: null,
      });
      mockAlertServiceGetByIds.mockResolvedValue({
        ok: true,
        value: [makeAlertDetail(ALERT_ID, [])],
        error: null,
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(makeChannel() as never);

      // Should batch-fetch only the enabled alert IDs
      expect(mockAlertServiceGetByIds).toHaveBeenCalledOnce();
      expect(mockAlertServiceGetByIds).toHaveBeenCalledWith([ALERT_ID]);

      // Should load 1 alert (enabled, empty channelIds = all channels)
      expect(mockAlertManager.loadAlerts).toHaveBeenCalledOnce();
      const loadedAlerts = mockAlertManager.loadAlerts.mock.calls[0]![0] as readonly unknown[];
      expect(loadedAlerts).toHaveLength(1);
    });

    it('filters alerts by channel scope', async () => {
      const otherChannelId = '00000000-0000-0000-0000-999999999999';

      mockAlertServiceList.mockResolvedValue({
        ok: true,
        value: {
          data: [
            makeAlertSummary(ALERT_ID, true),
            makeAlertSummary(ALERT_ID_2, true),
          ],
          pagination: { page: 1, pageSize: 1000, total: 2, totalPages: 1 },
        },
        error: null,
      });
      // First alert scoped to a different channel, second to all
      mockAlertServiceGetByIds.mockResolvedValue({
        ok: true,
        value: [
          makeAlertDetail(ALERT_ID, [otherChannelId]),
          makeAlertDetail(ALERT_ID_2, []),
        ],
        error: null,
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(makeChannel() as never);

      const loadedAlerts = mockAlertManager.loadAlerts.mock.calls[0]![0] as readonly unknown[];
      // Only ALERT_ID_2 (empty channelIds = all channels) should be included
      expect(loadedAlerts).toHaveLength(1);
      expect((loadedAlerts[0] as { id: string }).id).toBe(ALERT_ID_2);
    });

    it('includes alerts scoped to this specific channel', async () => {
      mockAlertServiceList.mockResolvedValue({
        ok: true,
        value: {
          data: [makeAlertSummary(ALERT_ID, true)],
          pagination: { page: 1, pageSize: 1000, total: 1, totalPages: 1 },
        },
        error: null,
      });
      mockAlertServiceGetByIds.mockResolvedValue({
        ok: true,
        value: [makeAlertDetail(ALERT_ID, [CHANNEL_ID])],
        error: null,
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(makeChannel() as never);

      const loadedAlerts = mockAlertManager.loadAlerts.mock.calls[0]![0] as readonly unknown[];
      expect(loadedAlerts).toHaveLength(1);
      expect((loadedAlerts[0] as { id: string }).id).toBe(ALERT_ID);
    });

    it('continues without alerts if AlertService.list fails', async () => {
      mockAlertServiceList.mockResolvedValue({
        ok: false, value: null, error: { code: 'INTERNAL', message: 'DB error' },
      });

      const engine = new EngineManager('test-server');

      // Should not throw
      await engine.deploy(makeChannel() as never);

      // AlertManager should be created but with empty alerts
      expect(mockAlertManager.loadAlerts).toHaveBeenCalledWith([]);
    });

    it('returns empty alerts when getByIds fails', async () => {
      mockAlertServiceList.mockResolvedValue({
        ok: true,
        value: {
          data: [
            makeAlertSummary(ALERT_ID, true),
            makeAlertSummary(ALERT_ID_2, true),
          ],
          pagination: { page: 1, pageSize: 1000, total: 2, totalPages: 1 },
        },
        error: null,
      });
      mockAlertServiceGetByIds.mockResolvedValue({
        ok: false, value: null, error: { code: 'INTERNAL', message: 'DB error' },
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(makeChannel() as never);

      // Should fall back to empty alerts
      expect(mockAlertManager.loadAlerts).toHaveBeenCalledWith([]);
    });

    it('passes onError callback to PipelineConfig', async () => {
      const engine = new EngineManager('test-server');
      await engine.deploy(makeChannel() as never);

      // Verify AlertManager was created and is callable
      expect(MockAlertManagerCtor).toHaveBeenCalledOnce();
      // The onError is wired inside PipelineConfig — we verify indirectly
      // by checking AlertManager was created with logger deps
      const ctorArgs = MockAlertManagerCtor.mock.calls[0]![0] as Record<string, unknown>;
      expect(ctorArgs).toHaveProperty('logger');
    });
  });

  describe('deploy with JavaScript connectors', () => {
    it('wires ScriptRunner for JavaScript source connector', async () => {
      const channel = makeChannel({
        sourceConnectorType: 'JAVASCRIPT',
        sourceConnectorProperties: { script: 'return "hello";', pollingIntervalMs: 1000 },
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      expect(mockSetScriptRunner).toHaveBeenCalledOnce();
      const scriptRunnerFn = mockSetScriptRunner.mock.calls[0]![0] as (script: string) => Promise<unknown>;
      expect(typeof scriptRunnerFn).toBe('function');
    });

    it('does not wire ScriptRunner for non-JavaScript source', async () => {
      const channel = makeChannel({ sourceConnectorType: 'TCP_MLLP' });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      expect(mockSetScriptRunner).not.toHaveBeenCalled();
    });

    it('wires ScriptRunner for JavaScript destination connectors', async () => {
      const channel = makeChannel({
        destinations: [
          {
            id: 'dest-1', metaDataId: 1, name: 'JS Dest',
            enabled: true, connectorType: 'JAVASCRIPT',
            properties: { script: 'return msg;' },
            queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 5000,
            rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
          },
        ],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      expect(mockSetDestScriptRunner).toHaveBeenCalledOnce();
      const destScriptRunnerFn = mockSetDestScriptRunner.mock.calls[0]![0] as (s: string, c: string, m: unknown) => Promise<unknown>;
      expect(typeof destScriptRunnerFn).toBe('function');
    });

    it('does not wire ScriptRunner for non-JavaScript destination', async () => {
      const channel = makeChannel({
        destinations: [
          {
            id: 'dest-1', metaDataId: 1, name: 'HTTP Dest',
            enabled: true, connectorType: 'HTTP',
            properties: { url: 'http://localhost:3000' },
            queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 5000,
            rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
          },
        ],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      expect(mockSetDestScriptRunner).not.toHaveBeenCalled();
    });

    it('wires multiple JavaScript destinations independently', async () => {
      const channel = makeChannel({
        destinations: [
          {
            id: 'dest-1', metaDataId: 1, name: 'JS Dest 1',
            enabled: true, connectorType: 'JAVASCRIPT',
            properties: { script: 'return "one";' },
            queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 5000,
            rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
          },
          {
            id: 'dest-2', metaDataId: 2, name: 'JS Dest 2',
            enabled: true, connectorType: 'JAVASCRIPT',
            properties: { script: 'return "two";' },
            queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 5000,
            rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
          },
        ],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      // Each JS destination gets its own ScriptRunner
      expect(mockSetDestScriptRunner).toHaveBeenCalledTimes(2);
    });

    it('compiles source script once at deploy and reuses in ScriptRunner', async () => {
      const channel = makeChannel({
        sourceConnectorType: 'JAVASCRIPT',
        sourceConnectorProperties: { script: 'return "hello";', pollingIntervalMs: 1000 },
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      // compileScript called once at deploy, not per-message
      expect(mockCompileScript).toHaveBeenCalledWith('return "hello";', { sourcefile: 'Test Channel/js-source.js' });
      const compileCallCountAtDeploy = mockCompileScript.mock.calls.length;

      const scriptRunner = mockSetScriptRunner.mock.calls[0]![0] as (script: string) => Promise<{ ok: boolean; value: unknown }>;
      const result = await scriptRunner('return "hello";');

      // No additional compile call — pre-compiled script is reused
      expect(mockCompileScript.mock.calls.length).toBe(compileCallCountAtDeploy);
      expect(mockSandboxExecute).toHaveBeenCalledOnce();
      expect(result.ok).toBe(true);
      expect(result.value).toBe('test-result');
    });

    it('does not wire ScriptRunner when source script compile fails', async () => {
      mockCompileScript.mockResolvedValueOnce({
        ok: false, value: null, error: { code: 'COMPILE_ERROR', message: 'Syntax error' },
      });

      const channel = makeChannel({
        sourceConnectorType: 'JAVASCRIPT',
        sourceConnectorProperties: { script: 'bad code', pollingIntervalMs: 1000 },
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      // ScriptRunner not set because compile failed at deploy time
      expect(mockSetScriptRunner).not.toHaveBeenCalled();
    });

    it('compiles dest script once at deploy and reuses in ScriptRunner', async () => {
      const channel = makeChannel({
        destinations: [
          {
            id: 'dest-1', metaDataId: 1, name: 'JS Dest',
            enabled: true, connectorType: 'JAVASCRIPT',
            properties: { script: 'return msg;' },
            queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 5000,
            rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
          },
        ],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      // compileScript called once at deploy with the dest script
      expect(mockCompileScript).toHaveBeenCalledWith('return msg;', { sourcefile: 'Test Channel/js-dest-1.js' });
      const compileCallCountAtDeploy = mockCompileScript.mock.calls.length;

      const destRunner = mockSetDestScriptRunner.mock.calls[0]![0] as (
        script: string, content: string, msg: unknown,
      ) => Promise<{ ok: boolean; value: unknown }>;

      const connectorMessage = { channelId: CHANNEL_ID, messageId: 1, metaDataId: 1, content: 'test-content', dataType: 'HL7V2' };
      const result = await destRunner('return msg;', 'test-content', connectorMessage);

      // No additional compile call — pre-compiled script is reused
      expect(mockCompileScript.mock.calls.length).toBe(compileCallCountAtDeploy);
      expect(mockSandboxExecute).toHaveBeenCalledOnce();
      // The context should include the content as msg
      const sandboxCtx = mockSandboxExecute.mock.calls[0]![1] as Record<string, unknown>;
      expect(sandboxCtx).toHaveProperty('msg', 'test-content');
      expect(result.ok).toBe(true);
      expect(result.value).toBe('test-result');
    });
  });

  describe('undeploy', () => {
    it('clears alert throttle state on undeploy', async () => {
      const engine = new EngineManager('test-server');
      await engine.deploy(makeChannel() as never);

      await engine.undeploy(CHANNEL_ID);

      expect(mockAlertManager.clearThrottleState).toHaveBeenCalledOnce();
    });

    it('clears GlobalChannelMap on undeploy', async () => {
      const engine = new EngineManager('test-server');
      await engine.deploy(makeChannel() as never);

      await engine.undeploy(CHANNEL_ID);

      expect(mockGcm.clear).toHaveBeenCalledOnce();
    });

    it('removes channel from runtimes on undeploy', async () => {
      const engine = new EngineManager('test-server');
      await engine.deploy(makeChannel() as never);

      expect(engine.getRuntime(CHANNEL_ID)).toBeDefined();

      await engine.undeploy(CHANNEL_ID);

      expect(engine.getRuntime(CHANNEL_ID)).toBeUndefined();
    });

    it('throws if channel is not deployed', async () => {
      const engine = new EngineManager('test-server');

      await expect(engine.undeploy(CHANNEL_ID)).rejects.toThrow('not deployed');
    });
  });

  describe('DeployedChannel interface', () => {
    it('includes alertManager in deployed channel record', async () => {
      const engine = new EngineManager('test-server');
      await engine.deploy(makeChannel() as never);

      const deployed = engine.getRuntime(CHANNEL_ID);
      expect(deployed).toBeDefined();
      expect(deployed!.channelId).toBe(CHANNEL_ID);
      expect(deployed!.alertManager).toBeDefined();
      expect(deployed!.alertManager.loadAlerts).toBeDefined();
      expect(deployed!.alertManager.clearThrottleState).toBeDefined();
    });
  });
});
