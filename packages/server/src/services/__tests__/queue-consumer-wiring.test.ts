// ===========================================
// Queue Consumer Wiring Tests
// ===========================================
// Tests that QueueConsumer instances are created during deploy()
// and their lifecycle is managed with start()/stop()/halt()/undeploy().

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock QueueConsumer -----

const mockQueueConsumerInstances: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; config: Record<string, unknown> }> = [];

const MockQueueConsumerCtor = vi.fn().mockImplementation((config: Record<string, unknown>) => {
  const instance = {
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    config,
  };
  mockQueueConsumerInstances.push(instance);
  return instance;
});

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
const MockVmSandboxExecutor = vi.fn().mockImplementation(() => ({
  execute: vi.fn().mockResolvedValue({
    ok: true,
    value: { returnValue: 'test-result', mapUpdates: { channelMap: {}, connectorMap: {}, globalChannelMap: {} }, logs: [] },
    error: null,
  }),
  dispose: vi.fn(),
}));

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
  QueueConsumer: MockQueueConsumerCtor,
  compileScript: vi.fn().mockResolvedValue({ ok: true, value: { code: 'compiled' }, error: null }),
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

// Mock services
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
  },
}));

vi.mock('../code-template.service.js', () => ({
  CodeTemplateService: {
    listTemplates: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
  },
}));

vi.mock('../global-script.service.js', () => ({
  GlobalScriptService: {
    getAll: vi.fn().mockResolvedValue({ ok: true, value: { preprocessor: null, postprocessor: null }, error: null }),
  },
}));

vi.mock('../alert.service.js', () => ({
  AlertService: {
    list: vi.fn().mockResolvedValue({
      ok: true,
      value: { data: [], pagination: { page: 1, pageSize: 1000, total: 0, totalPages: 0 } },
      error: null,
    }),
    getById: vi.fn(),
    getByIds: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
  },
}));

vi.mock('../email.service.js', () => ({
  EmailService: {
    sendMail: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  },
}));

// Mock DB
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

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

// Import after mocks
const { EngineManager } = await import('../../engine.js');
const { DeploymentService } = await import('../deployment.service.js');

// ----- Fixtures -----

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';

function makeDest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'dest-1',
    metaDataId: 1,
    name: 'HTTP Dest',
    enabled: true,
    connectorType: 'HTTP',
    properties: { url: 'http://localhost:3000' },
    queueMode: 'ON_FAILURE',
    retryCount: 5,
    retryIntervalMs: 15_000,
    rotateQueue: false,
    queueThreadCount: 1,
    waitForPrevious: false,
    ...overrides,
  };
}

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
  mockQueueConsumerInstances.length = 0;
});

// ----- Tests -----

describe('QueueConsumer wiring', () => {
  describe('deploy', () => {
    it('creates queue consumers for destinations with queueMode ON_FAILURE', async () => {
      const channel = makeChannel({
        destinations: [makeDest({ queueMode: 'ON_FAILURE' })],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      expect(MockQueueConsumerCtor).toHaveBeenCalledOnce();
      const deployed = engine.getRuntime(CHANNEL_ID);
      expect(deployed).toBeDefined();
      expect(deployed!.queueConsumers).toHaveLength(1);
    });

    it('creates queue consumers for destinations with queueMode ALWAYS', async () => {
      const channel = makeChannel({
        destinations: [makeDest({ queueMode: 'ALWAYS' })],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      expect(MockQueueConsumerCtor).toHaveBeenCalledOnce();
      expect(engine.getRuntime(CHANNEL_ID)!.queueConsumers).toHaveLength(1);
    });

    it('does NOT create queue consumers for queueMode NEVER', async () => {
      const channel = makeChannel({
        destinations: [makeDest({ queueMode: 'NEVER' })],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      expect(MockQueueConsumerCtor).not.toHaveBeenCalled();
      expect(engine.getRuntime(CHANNEL_ID)!.queueConsumers).toHaveLength(0);
    });

    it('uses destination retry settings in consumer config', async () => {
      const channel = makeChannel({
        destinations: [makeDest({ retryCount: 7, retryIntervalMs: 20_000 })],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      expect(MockQueueConsumerCtor).toHaveBeenCalledOnce();
      const config = MockQueueConsumerCtor.mock.calls[0]![0] as Record<string, unknown>;
      expect(config).toMatchObject({
        channelId: CHANNEL_ID,
        metaDataId: 1,
        serverId: 'test-server',
        retryCount: 7,
        retryIntervalMs: 20_000,
        batchSize: 10,
        pollIntervalMs: 1_000,
      });
    });

    it('creates separate consumers for multiple queued destinations', async () => {
      const channel = makeChannel({
        destinations: [
          makeDest({ id: 'dest-1', metaDataId: 1, queueMode: 'ON_FAILURE' }),
          makeDest({ id: 'dest-2', metaDataId: 2, queueMode: 'ALWAYS', name: 'Dest 2' }),
          makeDest({ id: 'dest-3', metaDataId: 3, queueMode: 'NEVER', name: 'Dest 3' }),
        ],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      // Only 2 consumers: dest-1 (ON_FAILURE) and dest-2 (ALWAYS), not dest-3 (NEVER)
      expect(MockQueueConsumerCtor).toHaveBeenCalledTimes(2);
      expect(engine.getRuntime(CHANNEL_ID)!.queueConsumers).toHaveLength(2);

      const configs = MockQueueConsumerCtor.mock.calls.map(
        (call) => (call[0] as Record<string, unknown>).metaDataId,
      );
      expect(configs).toContain(1);
      expect(configs).toContain(2);
    });

    it('stores empty array when no destinations are queued', async () => {
      const channel = makeChannel({ destinations: [] });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      expect(MockQueueConsumerCtor).not.toHaveBeenCalled();
      expect(engine.getRuntime(CHANNEL_ID)!.queueConsumers).toEqual([]);
    });
  });

  describe('undeploy', () => {
    it('stops all queue consumers on undeploy', async () => {
      const channel = makeChannel({
        destinations: [
          makeDest({ id: 'dest-1', metaDataId: 1, queueMode: 'ON_FAILURE' }),
          makeDest({ id: 'dest-2', metaDataId: 2, queueMode: 'ALWAYS', name: 'Dest 2' }),
        ],
      });

      const engine = new EngineManager('test-server');
      await engine.deploy(channel as never);

      await engine.undeploy(CHANNEL_ID);

      // Both consumers should have stop() called
      expect(mockQueueConsumerInstances).toHaveLength(2);
      for (const instance of mockQueueConsumerInstances) {
        expect(instance.stop).toHaveBeenCalledOnce();
      }
    });
  });

  describe('DeploymentService lifecycle', () => {
    it('starts queue consumers when channel starts', async () => {
      const mockRuntime = {
        getState: vi.fn().mockReturnValue('STARTED'),
        start: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        stop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        halt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        pause: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        resume: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
      };

      const mockConsumer = { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) };

      const deployedChannels = new Map<string, unknown>();
      deployedChannels.set(CHANNEL_ID, {
        channelId: CHANNEL_ID,
        runtime: mockRuntime,
        queueConsumers: [mockConsumer],
      });

      const { getEngine: getEngineFn } = await import('../../engine.js');
      const engine = getEngineFn();
      vi.spyOn(engine, 'getRuntime').mockImplementation(
        (id: string) => deployedChannels.get(id) as ReturnType<typeof engine.getRuntime>,
      );

      const result = await DeploymentService.start(CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockConsumer.start).toHaveBeenCalledOnce();
    });

    it('stops queue consumers when channel stops', async () => {
      const mockRuntime = {
        getState: vi.fn().mockReturnValue('STOPPED'),
        start: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        stop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        halt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        pause: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        resume: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
      };

      const mockConsumer = { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) };

      const deployedChannels = new Map<string, unknown>();
      deployedChannels.set(CHANNEL_ID, {
        channelId: CHANNEL_ID,
        runtime: mockRuntime,
        queueConsumers: [mockConsumer],
      });

      const { getEngine: getEngineFn } = await import('../../engine.js');
      const engine = getEngineFn();
      vi.spyOn(engine, 'getRuntime').mockImplementation(
        (id: string) => deployedChannels.get(id) as ReturnType<typeof engine.getRuntime>,
      );

      const result = await DeploymentService.stop(CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockConsumer.stop).toHaveBeenCalledOnce();
    });

    it('stops queue consumers when channel halts', async () => {
      const mockRuntime = {
        getState: vi.fn().mockReturnValue('STOPPED'),
        start: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        stop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        halt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        pause: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        resume: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
      };

      const mockConsumer1 = { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) };
      const mockConsumer2 = { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) };

      const deployedChannels = new Map<string, unknown>();
      deployedChannels.set(CHANNEL_ID, {
        channelId: CHANNEL_ID,
        runtime: mockRuntime,
        queueConsumers: [mockConsumer1, mockConsumer2],
      });

      const { getEngine: getEngineFn } = await import('../../engine.js');
      const engine = getEngineFn();
      vi.spyOn(engine, 'getRuntime').mockImplementation(
        (id: string) => deployedChannels.get(id) as ReturnType<typeof engine.getRuntime>,
      );

      const result = await DeploymentService.halt(CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockConsumer1.stop).toHaveBeenCalledOnce();
      expect(mockConsumer2.stop).toHaveBeenCalledOnce();
    });
  });
});
