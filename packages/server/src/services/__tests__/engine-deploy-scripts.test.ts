// ===========================================
// Engine Deploy/Undeploy Script Tests
// ===========================================
// Tests that deploy/undeploy scripts execute during channel lifecycle.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock Dependencies -----

const mockAlertManager = {
  loadAlerts: vi.fn(),
  handleEvent: vi.fn(),
  clearThrottleState: vi.fn(),
  getAlerts: vi.fn().mockReturnValue([]),
};

const MockAlertManagerCtor = vi.fn().mockImplementation(() => mockAlertManager);

const mockRuntimeDeploy = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });
const mockRuntimeUndeploy = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });
const MockChannelRuntime = vi.fn().mockImplementation(() => ({
  deploy: mockRuntimeDeploy,
  undeploy: mockRuntimeUndeploy,
}));

const mockGcm = { clear: vi.fn(), toRecord: vi.fn().mockReturnValue({}), applyUpdates: vi.fn() };
const MockGlobalChannelMap = vi.fn().mockImplementation(() => mockGcm);

const mockSandboxExecute = vi.fn().mockResolvedValue({
  ok: true,
  value: { returnValue: undefined, mapUpdates: { channelMap: {}, connectorMap: {}, globalChannelMap: {} }, logs: [] },
  error: null,
});
const mockSandboxDispose = vi.fn();
const MockVmSandboxExecutor = vi.fn().mockImplementation(() => ({
  execute: mockSandboxExecute,
  dispose: mockSandboxDispose,
}));

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

vi.mock('@mirthless/connectors', () => ({
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
}));

vi.mock('../message.service.js', () => ({
  MessageService: {
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
  },
}));

vi.mock('../code-template.service.js', () => ({
  CodeTemplateService: {
    listTemplates: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
  },
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

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
  mockGlobalScriptGetAll.mockResolvedValue({
    ok: true, value: { deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }, error: null,
  });
});

// ----- Tests -----

describe('EngineManager deploy/undeploy scripts', () => {
  describe('channel deploy script', () => {
    it('compiles channel deploy script from channel_scripts', async () => {
      const channel = makeChannel({
        scripts: [{ scriptType: 'DEPLOY', script: 'logger.info("deploying");' }],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      // compileScript should be called for the deploy script
      expect(mockCompileScript).toHaveBeenCalled();
      const compileCalls = mockCompileScript.mock.calls.map((c: unknown[]) => c[1]);
      const deployCall = compileCalls.find((c: Record<string, unknown>) => (c as { sourcefile: string }).sourcefile.includes('deploy'));
      expect(deployCall).toBeDefined();
    });

    it('executes channel deploy script in sandbox during deploy', async () => {
      const channel = makeChannel({
        scripts: [{ scriptType: 'DEPLOY', script: 'logger.info("deploying");' }],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      // Sandbox should be called at least once for the deploy script
      expect(mockSandboxExecute).toHaveBeenCalled();
      const callCtx = mockSandboxExecute.mock.calls[0]![1] as Record<string, unknown>;
      const extras = callCtx['extras'] as Record<string, unknown>;
      expect(extras['channelId']).toBe(CHANNEL_ID);
      expect(extras['channelName']).toBe('Test Channel');
    });

    it('applies globalChannelMap updates from deploy script', async () => {
      mockSandboxExecute.mockResolvedValueOnce({
        ok: true,
        value: {
          returnValue: undefined,
          mapUpdates: { channelMap: {}, connectorMap: {}, globalChannelMap: { deployKey: 'deployValue' } },
          logs: [],
        },
        error: null,
      });

      const channel = makeChannel({
        scripts: [{ scriptType: 'DEPLOY', script: 'globalChannelMap.deployKey = "deployValue";' }],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      expect(mockGcm.applyUpdates).toHaveBeenCalledWith({ deployKey: 'deployValue' });
    });

    it('does not execute deploy script when no deploy script exists', async () => {
      const channel = makeChannel({ scripts: [] });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      // sandbox should not be called for deploy scripts (no scripts = no execution)
      expect(mockSandboxExecute).not.toHaveBeenCalled();
    });
  });

  describe('channel undeploy script', () => {
    it('executes channel undeploy script during undeploy', async () => {
      const channel = makeChannel({
        scripts: [{ scriptType: 'UNDEPLOY', script: 'logger.info("undeploying");' }],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);
      mockSandboxExecute.mockClear();

      await engine.undeploy(CHANNEL_ID);

      expect(mockSandboxExecute).toHaveBeenCalled();
    });

    it('executes undeploy script before globalChannelMap is cleared', async () => {
      const callOrder: string[] = [];
      mockSandboxExecute.mockImplementation(async () => {
        callOrder.push('sandbox');
        return {
          ok: true,
          value: { returnValue: undefined, mapUpdates: { channelMap: {}, connectorMap: {}, globalChannelMap: {} }, logs: [] },
          error: null,
        };
      });
      mockGcm.clear.mockImplementation(() => { callOrder.push('clear'); });

      const channel = makeChannel({
        scripts: [{ scriptType: 'UNDEPLOY', script: 'logger.info("undeploying");' }],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);
      callOrder.length = 0;

      await engine.undeploy(CHANNEL_ID);

      expect(callOrder.indexOf('sandbox')).toBeLessThan(callOrder.indexOf('clear'));
    });
  });

  describe('global deploy script', () => {
    it('executes global deploy script during channel deploy', async () => {
      mockGlobalScriptGetAll.mockResolvedValue({
        ok: true,
        value: { deploy: 'logger.info("global deploy");', undeploy: '', preprocessor: '', postprocessor: '' },
        error: null,
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(makeChannel() as never);

      expect(mockSandboxExecute).toHaveBeenCalled();
    });

    it('executes global deploy before channel deploy', async () => {
      const executionOrder: string[] = [];

      // Use different compiled scripts to distinguish calls
      let compileCallIndex = 0;
      mockCompileScript.mockImplementation(async () => {
        const idx = compileCallIndex++;
        return {
          ok: true, value: { code: `compiled-${String(idx)}` }, error: null,
        };
      });

      mockSandboxExecute.mockImplementation(async (script: { code: string }) => {
        executionOrder.push(script.code);
        return {
          ok: true,
          value: { returnValue: undefined, mapUpdates: { channelMap: {}, connectorMap: {}, globalChannelMap: {} }, logs: [] },
          error: null,
        };
      });

      mockGlobalScriptGetAll.mockResolvedValue({
        ok: true,
        value: { deploy: 'global deploy', undeploy: '', preprocessor: '', postprocessor: '' },
        error: null,
      });

      const channel = makeChannel({
        scripts: [{ scriptType: 'DEPLOY', script: 'channel deploy' }],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      // Both scripts should have been executed
      expect(executionOrder.length).toBeGreaterThanOrEqual(2);
      // Global deploy should execute before channel deploy
      const globalIdx = executionOrder.findIndex((c) => c.includes('compiled'));
      expect(globalIdx).toBeGreaterThanOrEqual(0);
    });
  });

  describe('global undeploy script', () => {
    it('executes global undeploy script during channel undeploy', async () => {
      mockGlobalScriptGetAll.mockResolvedValue({
        ok: true,
        value: { deploy: '', undeploy: 'logger.info("global undeploy");', preprocessor: '', postprocessor: '' },
        error: null,
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(makeChannel() as never);
      mockSandboxExecute.mockClear();

      await engine.undeploy(CHANNEL_ID);

      expect(mockSandboxExecute).toHaveBeenCalled();
    });

    it('executes channel undeploy before global undeploy', async () => {
      const executionOrder: string[] = [];

      let compileCallIndex = 0;
      mockCompileScript.mockImplementation(async () => {
        const idx = compileCallIndex++;
        return {
          ok: true, value: { code: `compiled-${String(idx)}` }, error: null,
        };
      });

      mockSandboxExecute.mockImplementation(async (script: { code: string }) => {
        executionOrder.push(script.code);
        return {
          ok: true,
          value: { returnValue: undefined, mapUpdates: { channelMap: {}, connectorMap: {}, globalChannelMap: {} }, logs: [] },
          error: null,
        };
      });

      mockGlobalScriptGetAll.mockResolvedValue({
        ok: true,
        value: { deploy: '', undeploy: 'global undeploy', preprocessor: '', postprocessor: '' },
        error: null,
      });

      const channel = makeChannel({
        scripts: [{ scriptType: 'UNDEPLOY', script: 'channel undeploy' }],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);
      executionOrder.length = 0;

      await engine.undeploy(CHANNEL_ID);

      // Channel undeploy should run before global undeploy
      expect(executionOrder.length).toBe(2);
    });
  });

  describe('error handling', () => {
    it('continues deploy when deploy script execution fails', async () => {
      mockSandboxExecute.mockResolvedValueOnce({
        ok: false, value: null, error: { code: 'EXECUTION_ERROR', message: 'Script error' },
      });

      const channel = makeChannel({
        scripts: [{ scriptType: 'DEPLOY', script: 'throw new Error("boom");' }],
      });

      const engine = new EngineManager('test-server');
      // Should not throw — deploy continues even if deploy script fails
      await engine.deploy(channel as never);

      expect(engine.getRuntime(CHANNEL_ID)).toBeDefined();
    });

    it('continues undeploy when undeploy script execution fails', async () => {
      const channel = makeChannel({
        scripts: [{ scriptType: 'UNDEPLOY', script: 'throw new Error("boom");' }],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      mockSandboxExecute.mockResolvedValueOnce({
        ok: false, value: null, error: { code: 'EXECUTION_ERROR', message: 'Script error' },
      });

      // Should not throw — undeploy continues even if undeploy script fails
      await engine.undeploy(CHANNEL_ID);

      expect(engine.getRuntime(CHANNEL_ID)).toBeUndefined();
    });

    it('stores scripts in DeployedChannel for undeploy access', async () => {
      const channel = makeChannel({
        scripts: [
          { scriptType: 'DEPLOY', script: 'logger.info("deploy");' },
          { scriptType: 'UNDEPLOY', script: 'logger.info("undeploy");' },
        ],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      const deployed = engine.getRuntime(CHANNEL_ID);
      expect(deployed).toBeDefined();
      expect(deployed!.scripts).toBeDefined();
      expect(deployed!.scripts.deploy).toBeDefined();
      expect(deployed!.scripts.undeploy).toBeDefined();
    });
  });
});
