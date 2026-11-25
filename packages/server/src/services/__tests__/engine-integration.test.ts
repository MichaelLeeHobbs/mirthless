import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bundleOf } from '../../../test/deployment-bundle.js';

const mockAlertManager = {
  loadAlerts: vi.fn(),
  handleEvent: vi.fn(),
  clearThrottleState: vi.fn(),
  getAlerts: vi.fn().mockReturnValue([]),
};

const MockAlertManagerCtor = vi.fn().mockImplementation(function () { return mockAlertManager; });

const mockRuntimeDeploy = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });
const mockRuntimeUndeploy = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });
const mockRuntimeStop = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });
const mockRuntimeHalt = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });
const mockRuntimeGetState = vi.fn().mockReturnValue('STOPPED');
const mockChannelRuntime = {
  deploy: mockRuntimeDeploy,
  undeploy: mockRuntimeUndeploy,
  stop: mockRuntimeStop,
  halt: mockRuntimeHalt,
  getState: mockRuntimeGetState,
  backgroundEnds: vi.fn().mockResolvedValue(true),
};
const MockChannelRuntime = vi.fn().mockImplementation(function () { return mockChannelRuntime; });

const mockGcm = { clear: vi.fn(), toRecord: vi.fn().mockReturnValue({}), applyChanges: vi.fn() };
const MockGlobalChannelMap = vi.fn().mockImplementation(function () { return mockGcm; });

const mockSandboxExecute = vi.fn().mockResolvedValue({
  ok: true,
  value: { returnValue: 'test-result', mapUpdates: { channelMap: {}, connectorMap: {}, globalChannelMap: {} }, logs: [] },
  error: null,
});
const mockSandboxDispose = vi.fn();
const MockVmSandboxExecutor = vi.fn().mockImplementation(function () {
  return {
    execute: mockSandboxExecute,
    dispose: mockSandboxDispose,
  };
});

const mockCompileScript = vi.fn().mockResolvedValue({
  ok: true, value: { code: 'compiled-code' }, error: null,
});

const mockGlobalsNamed = vi.fn().mockResolvedValue({ ok: true, value: ['$c'], error: null });

vi.mock('@galvanigraph/engine', () => ({
  ChannelRuntime: MockChannelRuntime,
  VmSandboxExecutor: MockVmSandboxExecutor,
  MessageProcessor: vi.fn().mockImplementation(function () {
    return {
      processMessage: vi.fn().mockResolvedValue({
        ok: true, value: { messageId: 1, status: 'SENT', destinationResults: [] }, error: null,
      }),
    };
  }),
  DEFAULT_EXECUTION_OPTIONS: { timeout: 30000, memoryLimit: 134217728, signal: AbortSignal.timeout(30000) },
  parseForSandbox: (content: string, dataType: string): unknown => {
    if (content === 'unparseable') throw new Error('bad');
    return { parsed: content, dataType };
  },
  GlobalChannelMap: MockGlobalChannelMap,
  GlobalMapProxy: vi.fn().mockImplementation(function () { return { load: vi.fn(), start: vi.fn(), toRecord: vi.fn().mockReturnValue({}), applyChanges: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn(), flush: vi.fn().mockResolvedValue(undefined), dispose: vi.fn().mockResolvedValue(undefined) }; }),
  QueueConsumer: vi.fn().mockImplementation(function () {
    return { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined), halt: vi.fn().mockResolvedValue(undefined) };
  }),
  compileScript: mockCompileScript,
  globalsNamed: mockGlobalsNamed,
  compileFilterRulesToScript: vi.fn().mockReturnValue({ ok: true, value: null, error: null }),
  compileTransformerStepsToScript: vi.fn().mockReturnValue({ ok: true, value: null, error: null }),
  prependTemplates: vi.fn().mockImplementation((src: string) => src),
  AlertManager: MockAlertManagerCtor,
  RecoveryManager: vi.fn().mockImplementation(function () {
    return {
      recover: vi.fn().mockResolvedValue({ ok: true, value: { recovered: 0, errors: 0, skipped: 0 }, error: null }),
    };
  }),
}));

const mockSetScriptRunner = vi.fn();
const mockSetDestScriptRunner = vi.fn();

const MockJavaScriptReceiver = vi.fn().mockImplementation(function () {
  return {
    setScriptRunner: mockSetScriptRunner,
    setDispatcher: vi.fn(),
    onDeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onStart: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onStop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onHalt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onUndeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  };
});

const MockJavaScriptDispatcher = vi.fn().mockImplementation(function () {
  return {
    setScriptRunner: mockSetDestScriptRunner,
    send: vi.fn().mockResolvedValue({ ok: true, value: { status: 'SENT', content: '' }, error: null }),
    onDeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onStart: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onStop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onHalt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onUndeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  };
});

let _lastSourceConnector: unknown = null;
let destConnectorsByCall: unknown[] = [];

vi.mock('@galvanigraph/connectors', () => ({
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
    resetPending: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    waitingByDestination: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
    getUnprocessedMessages: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
    getLatestMessageId: vi.fn().mockResolvedValue({ ok: true, value: 0, error: null }),
    getConnectorMessages: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
  },
}));

vi.mock('../global-map.service.js', () => ({
  GlobalMapService: { list: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }), upsert: vi.fn(), persist: vi.fn(), persistRemoval: vi.fn(), onChange: vi.fn() },
}));

vi.mock('../config-map.service.js', () => ({
  ConfigMapService: { list: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }) },
}));

const mockAlertServiceListEnabled = vi.fn();

vi.mock('../alert.service.js', () => ({
  AlertService: {
    listEnabled: mockAlertServiceListEnabled,
    onChange: vi.fn(),
  },
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
    metadataColumns: [],
    destinations: [],
    scripts: [],
    filters: [],
    transformers: [],
    ...overrides,
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

beforeEach(() => {
  vi.clearAllMocks();
  _lastSourceConnector = null;
  destConnectorsByCall = [];
  mockRuntimeGetState.mockReturnValue('STOPPED');
  mockRuntimeStop.mockResolvedValue({ ok: true, value: undefined, error: null });
  mockRuntimeHalt.mockResolvedValue({ ok: true, value: undefined, error: null });
  mockAlertServiceListEnabled.mockResolvedValue({
    ok: true, value: [], error: null,
  });
});

describe('EngineManager', () => {
  describe('deploy with AlertManager', () => {
    it('creates an AlertManager and stores it in DeployedChannel', async () => {
      const engine = new EngineManager('test-server');
      const channel = makeChannel();

      await engine.deploy(bundleOf(channel as never));

      expect(MockAlertManagerCtor).toHaveBeenCalledOnce();
      const deployed = engine.getRuntime(CHANNEL_ID);
      expect(deployed).toBeDefined();
      expect(deployed!.alertManager).toBe(mockAlertManager);
    });

    it('loads enabled alerts and passes them to AlertManager', async () => {
      mockAlertServiceListEnabled.mockResolvedValue({
        ok: true,
        value: [makeAlertDetail(ALERT_ID, [])],
        error: null,
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel() as never));

      expect(mockAlertManager.loadAlerts).toHaveBeenCalledOnce();
      const loadedAlerts = mockAlertManager.loadAlerts.mock.calls[0]![0] as readonly unknown[];
      expect(loadedAlerts).toHaveLength(1);
    });

    it('filters alerts by channel scope', async () => {
      const otherChannelId = '00000000-0000-0000-0000-999999999999';

      mockAlertServiceListEnabled.mockResolvedValue({
        ok: true,
        value: [
          makeAlertDetail(ALERT_ID, [otherChannelId]),
          makeAlertDetail(ALERT_ID_2, []),
        ],
        error: null,
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel() as never));

      const loadedAlerts = mockAlertManager.loadAlerts.mock.calls[0]![0] as readonly unknown[];
      // Empty channelIds means all channels.
      expect(loadedAlerts).toHaveLength(1);
      expect((loadedAlerts[0] as { id: string }).id).toBe(ALERT_ID_2);
    });

    it('includes alerts scoped to this specific channel', async () => {
      mockAlertServiceListEnabled.mockResolvedValue({
        ok: true,
        value: [makeAlertDetail(ALERT_ID, [CHANNEL_ID])],
        error: null,
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel() as never));

      const loadedAlerts = mockAlertManager.loadAlerts.mock.calls[0]![0] as readonly unknown[];
      expect(loadedAlerts).toHaveLength(1);
      expect((loadedAlerts[0] as { id: string }).id).toBe(ALERT_ID);
    });

    it('refuses to deploy when the alerts cannot be loaded', async () => {
      mockAlertServiceListEnabled.mockResolvedValue({
        ok: false, value: null, error: { code: 'INTERNAL', message: 'DB error' },
      });

      const engine = new EngineManager('test-server');

      await expect(engine.deploy(bundleOf(makeChannel() as never))).rejects.toThrow('failed to load alerts: DB error');
      expect(engine.getRuntime(CHANNEL_ID)).toBeUndefined();
    });

    it('passes onError callback to PipelineConfig', async () => {
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel() as never));

      expect(MockAlertManagerCtor).toHaveBeenCalledOnce();
      // onError is wired inside PipelineConfig, so this checks it only indirectly.
      const ctorArgs = MockAlertManagerCtor.mock.calls[0]![0] as Record<string, unknown>;
      expect(ctorArgs).toHaveProperty('logger');
    });
  });

  // A DICOM Sender imported from Mirth carries Mirth's default template, which means "the message".
  describe('destination templates', () => {
    const dicomDest = (template: string): Record<string, unknown> => ({
      id: 'dest-1', metaDataId: 1, name: 'PACS', enabled: true, connectorType: 'DICOM',
      properties: { host: 'pacs', port: 104, template },
      queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 5000, rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
    });
    const templateGiven = async (template: string): Promise<unknown> => {
      const { MessageProcessor } = await import('@galvanigraph/engine');
      const ctor = vi.mocked(MessageProcessor);
      ctor.mockClear();
      await new EngineManager('test-server').deploy(bundleOf(makeChannel({ destinations: [dicomDest(template)] }) as never));
      const pipeline = ctor.mock.calls[0]?.[3] as { destinations: ReadonlyArray<{ template?: string }> };
      return pipeline.destinations[0]?.template;
    };

    it("sends the message itself for Mirth's ${DICOMMESSAGE}, not the text", async () => {
      expect(await templateGiven('${DICOMMESSAGE}')).toBeUndefined();
    });

    it('keeps any other template', async () => {
      expect(await templateGiven('${message.encodedData}')).toBe('${message.encodedData}');
    });
  });

  describe('deploy with JavaScript connectors', () => {
    it('wires ScriptRunner for JavaScript source connector', async () => {
      const channel = makeChannel({
        sourceConnectorType: 'JAVASCRIPT',
        sourceConnectorProperties: { script: 'return "hello";', pollingIntervalMs: 1000 },
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(channel as never));

      expect(mockSetScriptRunner).toHaveBeenCalledOnce();
      const scriptRunnerFn = mockSetScriptRunner.mock.calls[0]![0] as (script: string) => Promise<unknown>;
      expect(typeof scriptRunnerFn).toBe('function');
    });

    it('does not wire ScriptRunner for non-JavaScript source', async () => {
      const channel = makeChannel({ sourceConnectorType: 'TCP_MLLP' });

      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(channel as never));

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
      await engine.deploy(bundleOf(channel as never));

      expect(mockSetDestScriptRunner).toHaveBeenCalledOnce();
      const destScriptRunnerFn = mockSetDestScriptRunner.mock.calls[0]![0] as (s: string, c: string, m: unknown) => Promise<unknown>;
      expect(typeof destScriptRunnerFn).toBe('function');
      // What recovery goes by (#390): what the script, with its code templates, can read the variables by.
      expect(mockGlobalsNamed).toHaveBeenCalledExactlyOnceWith({ code: 'compiled-code' }, ['channelMap', '$c', '$', 'connectorMessage', 'globalThis']);
      expect(mockSetDestScriptRunner.mock.calls[0]![1]).toEqual(['$c']);
    });

    it('does not deploy a JavaScript destination whose script could not be looked through', async () => {
      mockGlobalsNamed.mockResolvedValueOnce({ ok: false, value: null, error: new Error('esbuild is gone') });
      const channel = makeChannel({
        destinations: [{
          id: 'dest-1', metaDataId: 1, name: 'JS Dest', enabled: true, connectorType: 'JAVASCRIPT',
          properties: { script: 'return msg;' },
          queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 5000, rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
        }],
      });

      await expect(new EngineManager('test-server').deploy(bundleOf(channel as never))).rejects.toThrow('esbuild is gone');
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
      await engine.deploy(bundleOf(channel as never));

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
      await engine.deploy(bundleOf(channel as never));

      expect(mockSetDestScriptRunner).toHaveBeenCalledTimes(2);
    });

    it('gives a JavaScript Writer the message parsed for its data type and the message\'s channel map', async () => {
      const channel = makeChannel({
        destinations: [{
          id: 'dest-1', metaDataId: 1, name: 'JS Dest', enabled: true, connectorType: 'JAVASCRIPT',
          properties: { script: 'return msg;' },
          queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 5000, rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
        }],
      });
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(channel as never));
      const runner = mockSetDestScriptRunner.mock.calls[0]![0] as (s: string, c: string, m: unknown) => Promise<unknown>;

      await runner('return msg;', 'MSH|^~\\&|A', { dataType: 'HL7V2', variables: { accession: 'ACC1' } });
      await runner('return msg;', 'unparseable', { dataType: 'HL7V2' });

      const contexts = mockSandboxExecute.mock.calls.map((c) => c[1] as { msg: unknown; rawData: string; channelMap: unknown });
      expect(contexts.at(-2)).toMatchObject({ msg: { parsed: 'MSH|^~\\&|A', dataType: 'HL7V2' }, rawData: 'MSH|^~\\&|A', channelMap: { accession: 'ACC1' } });
      expect(contexts.at(-1)).toMatchObject({ msg: 'unparseable', channelMap: {} });
    });

    it('compiles source script once at deploy and reuses in ScriptRunner', async () => {
      const channel = makeChannel({
        sourceConnectorType: 'JAVASCRIPT',
        sourceConnectorProperties: { script: 'return "hello";', pollingIntervalMs: 1000 },
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(channel as never));

      expect(mockCompileScript).toHaveBeenCalledWith('return "hello";', { sourcefile: 'Test Channel/js-source.js' });
      const compileCallCountAtDeploy = mockCompileScript.mock.calls.length;

      const scriptRunner = mockSetScriptRunner.mock.calls[0]![0] as (script: string) => Promise<{ ok: boolean; value: unknown }>;
      const result = await scriptRunner('return "hello";');

      expect(mockCompileScript.mock.calls.length).toBe(compileCallCountAtDeploy);
      expect(mockSandboxExecute).toHaveBeenCalledOnce();
      expect(result.ok).toBe(true);
      expect(result.value).toBe('test-result');
    });

    it('refuses to deploy when the source script does not compile', async () => {
      mockCompileScript.mockResolvedValueOnce({
        ok: false, value: null, error: { code: 'COMPILE_ERROR', message: 'Syntax error' },
      });

      const channel = makeChannel({
        sourceConnectorType: 'JAVASCRIPT',
        sourceConnectorProperties: { script: 'bad code', pollingIntervalMs: 1000 },
      });

      const engine = new EngineManager('test-server');

      await expect(engine.deploy(bundleOf(channel as never))).rejects.toThrow('js-source.js failed to compile');
      expect(mockSetScriptRunner).not.toHaveBeenCalled();
      expect(engine.getRuntime(CHANNEL_ID)).toBeUndefined();
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
      await engine.deploy(bundleOf(channel as never));

      expect(mockCompileScript).toHaveBeenCalledWith('return msg;', { sourcefile: 'Test Channel/js-dest-1.js' });
      const compileCallCountAtDeploy = mockCompileScript.mock.calls.length;

      const destRunner = mockSetDestScriptRunner.mock.calls[0]![0] as (
        script: string, content: string, msg: unknown,
      ) => Promise<{ ok: boolean; value: unknown }>;

      const connectorMessage = { channelId: CHANNEL_ID, messageId: 1, metaDataId: 1, content: 'test-content', dataType: 'HL7V2' };
      const result = await destRunner('return msg;', 'test-content', connectorMessage);

      expect(mockCompileScript.mock.calls.length).toBe(compileCallCountAtDeploy);
      expect(mockSandboxExecute).toHaveBeenCalledOnce();
      const sandboxCtx = mockSandboxExecute.mock.calls[0]![1] as Record<string, unknown>;
      expect(sandboxCtx).toHaveProperty('msg', { parsed: 'test-content', dataType: 'HL7V2' });
      expect(sandboxCtx).toHaveProperty('rawData', 'test-content');
      expect(result.ok).toBe(true);
      expect(result.value).toBe('test-result');
    });
  });

  describe('undeploy', () => {
    it('clears alert throttle state on undeploy', async () => {
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel() as never));

      await engine.undeploy(CHANNEL_ID);

      expect(mockAlertManager.clearThrottleState).toHaveBeenCalledOnce();
    });

    it('clears GlobalChannelMap on undeploy', async () => {
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel() as never));

      await engine.undeploy(CHANNEL_ID);

      expect(mockGcm.clear).toHaveBeenCalledOnce();
    });

    it('removes channel from runtimes on undeploy', async () => {
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel() as never));

      expect(engine.getRuntime(CHANNEL_ID)).toBeDefined();

      await engine.undeploy(CHANNEL_ID);

      expect(engine.getRuntime(CHANNEL_ID)).toBeUndefined();
    });

    it('throws if channel is not deployed', async () => {
      const engine = new EngineManager('test-server');

      await expect(engine.undeploy(CHANNEL_ID)).rejects.toThrow('not deployed');
    });

    it('stops a STARTED channel before undeploying it (graceful shutdown safety)', async () => {
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel() as never));
      mockRuntimeGetState.mockReturnValueOnce('STARTED');

      await engine.undeploy(CHANNEL_ID);

      // Must stop (drain source) before runtime.undeploy(), which requires STOPPED.
      expect(mockRuntimeStop).toHaveBeenCalledOnce();
      expect(mockRuntimeUndeploy).toHaveBeenCalledOnce();
      expect(engine.getRuntime(CHANNEL_ID)).toBeUndefined();
    });

    it('force-halts a STARTED channel when a graceful stop fails', async () => {
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel() as never));
      mockRuntimeGetState.mockReturnValueOnce('STARTED');
      mockRuntimeStop.mockResolvedValue({ ok: false, value: null, error: new Error('stop boom') });

      await engine.undeploy(CHANNEL_ID);

      expect(mockRuntimeStop).toHaveBeenCalledOnce();
      expect(mockRuntimeHalt).toHaveBeenCalledOnce();
      expect(engine.getRuntime(CHANNEL_ID)).toBeUndefined();
    });
  });

  describe('DeployedChannel interface', () => {
    it('includes alertManager in deployed channel record', async () => {
      const engine = new EngineManager('test-server');
      await engine.deploy(bundleOf(makeChannel() as never));

      const deployed = engine.getRuntime(CHANNEL_ID);
      expect(deployed).toBeDefined();
      expect(deployed!.channelId).toBe(CHANNEL_ID);
      expect(deployed!.alertManager).toBeDefined();
      expect(deployed!.alertManager.loadAlerts).toBeDefined();
      expect(deployed!.alertManager.clearThrottleState).toBeDefined();
    });
  });
});
