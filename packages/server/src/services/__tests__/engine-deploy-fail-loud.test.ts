// ===========================================
// Engine Deploy: Fail Loud Tests
// ===========================================
// A channel must never start with fewer scripts than it was configured with.
// These tests use the real engine package (compiler and sandbox) and fake only
// the database, the services that read it and the connectors that open sockets.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isServiceError } from '../../lib/service-error.js';

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
    getUnprocessedMessages: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
    getLatestMessageId: vi.fn().mockResolvedValue({ ok: true, value: 0, error: null }),
    getConnectorMessages: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
  },
}));

const mockGlobalMapList = vi.fn();
vi.mock('../global-map.service.js', () => ({
  GlobalMapService: { list: mockGlobalMapList, upsert: vi.fn(), persist: vi.fn(), persistRemoval: vi.fn(), onChange: vi.fn() },
}));

const mockConfigMapList = vi.fn();
vi.mock('../config-map.service.js', () => ({
  ConfigMapService: { list: mockConfigMapList },
}));

const mockListTemplates = vi.fn();
vi.mock('../code-template.service.js', () => ({
  CodeTemplateService: { listTemplatesForChannel: mockListTemplates },
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

// The two queries deploy runs: filter rules first, then transformer steps.
let filterRows: ReadonlyArray<Record<string, unknown>> = [];
let transformerRows: ReadonlyArray<Record<string, unknown>> = [];
let selectCalls = 0;
const mockSelect = vi.fn().mockImplementation(() => {
  selectCalls += 1;
  const rows = selectCalls % 2 === 1 ? filterRows : transformerRows;
  return { from: () => ({ leftJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }) }) };
});

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
const DB_DOWN = { ok: false, value: null, error: new Error('connection refused') };

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

function filterRow(rule: Record<string, unknown>, index = 0): Record<string, unknown> {
  return {
    filterId: 'f1', connectorId: null, ruleId: `r${String(index)}`, sequenceNumber: index,
    enabled: true, operator: 'AND', type: 'JAVASCRIPT', script: null, field: null, condition: null, values: null,
    ...rule,
  };
}

function stepRow(step: Record<string, unknown>, index = 0): Record<string, unknown> {
  return {
    transformerId: 't1', connectorId: null, stepId: `s${String(index)}`, sequenceNumber: index,
    enabled: true, type: 'JAVASCRIPT', script: null,
    ...step,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  filterRows = [];
  transformerRows = [];
  selectCalls = 0;
  mockListTemplates.mockResolvedValue(OK_EMPTY);
  mockGlobalMapList.mockResolvedValue(OK_EMPTY);
  mockConfigMapList.mockResolvedValue(OK_EMPTY);
  mockGlobalScriptGetAll.mockResolvedValue({
    ok: true, value: { deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }, error: null,
  });
});

async function deployError(channel: never = makeChannel()): Promise<string> {
  const engine = new EngineManager('test-server');
  const outcome = await engine.deploy(channel).then(() => 'deployed', (e: unknown) => (e as Error).message);
  if (outcome !== 'deployed') expect(engine.getRuntime(CHANNEL_ID)).toBeUndefined();
  return outcome;
}

// ----- Tests -----

describe('EngineManager.deploy refuses to start a channel it cannot run as configured', () => {
  it('refuses a channel that responds from a destination it does not have (renamed or removed)', async () => {
    const engine = new EngineManager('test-server');
    await expect(engine.deploy(makeChannel({ responseMode: 'DESTINATION', responseConnectorName: 'Old Name' })))
      .rejects.toThrow('responds from destination "Old Name", which it does not have');
  });

  it('refuses batch processing on a data type it cannot split', async () => {
    const engine = new EngineManager('test-server');
    await expect(engine.deploy(makeChannel({ inboundDataType: 'JSON', sourceConnectorProperties: { port: 6661, processBatch: true } })))
      .rejects.toThrow('batch processing is only supported for HL7V2, not JSON');
  });

  it('deploys a channel whose scripts all compile', async () => {
    filterRows = [filterRow({ script: 'return msg.get("MSH.9.1") === "ADT";' })];
    transformerRows = [stepRow({ script: 'msg.delete("PID.19");' })];

    const engine = new EngineManager('test-server');
    await engine.deploy(makeChannel());

    const scripts = engine.getRuntime(CHANNEL_ID)?.scripts;
    expect(scripts?.sourceFilter?.code).toContain('MSH.9.1');
    expect(scripts?.sourceTransformer?.code).toContain('PID.19');
  });

  it('fails when a source filter rule has a syntax error', async () => {
    filterRows = [filterRow({ script: 'return msg.get("MSH.9.1" === ;' })];

    expect(await deployError()).toMatch(/^Script Labs\/sourceFilter\.ts failed to compile/);
  });

  it('fails when a source transformer step has a syntax error', async () => {
    transformerRows = [stepRow({ script: 'msg.delete("PID.19"' })];

    expect(await deployError()).toMatch(/^Script Labs\/sourceTransformer\.ts failed to compile/);
  });

  it('fails when a channel preprocessor has a syntax error', async () => {
    const channel = makeChannel({ scripts: [{ scriptType: 'PREPROCESSOR', script: 'return ((;' }] });

    expect(await deployError(channel)).toMatch(/^Script Labs\/preprocessor\.ts failed to compile/);
  });

  it('fails when a global script has a syntax error', async () => {
    mockGlobalScriptGetAll.mockResolvedValue({
      ok: true, value: { deploy: '', undeploy: '', preprocessor: 'function {', postprocessor: '' }, error: null,
    });

    expect(await deployError()).toMatch(/^Script global\/preprocessor\.ts failed to compile/);
  });

  it('fails when a code template breaks an otherwise valid filter', async () => {
    mockListTemplates.mockResolvedValue({
      ok: true,
      value: [{ code: 'function broken( {', type: 'FUNCTION', contexts: ['SOURCE_FILTER_TRANSFORMER'] }],
      error: null,
    });
    filterRows = [filterRow({ script: 'return true;' })];

    expect(await deployError()).toContain('failed to compile (it includes the code templates for sourceFilter)');
  });

  it('fails when an enabled Mapper step has nothing the engine can run', async () => {
    transformerRows = [stepRow({ script: 'msg.delete("PID.19");' }), stepRow({ type: 'MAPPER' }, 1)];

    expect(await deployError()).toBe('Labs source transformer: Transformer step 2 has type MAPPER, which this engine cannot run');
  });

  it('fails when a Rule Builder rule is incomplete', async () => {
    filterRows = [filterRow({ type: 'RULE_BUILDER', field: 'MSH.9.1', condition: 'EQUALS', values: [] })];

    expect(await deployError()).toBe('Labs source filter: Filter rule 1 (Rule Builder) needs at least one value for EQUALS');
  });

  it('reports a script that will not compile as invalid input, so the API can say why', async () => {
    mockGlobalScriptGetAll.mockResolvedValue({
      ok: true, value: { deploy: "logger.info('x');/ E2E test", undeploy: '', preprocessor: '', postprocessor: '' }, error: null,
    });

    const error: unknown = await new EngineManager('test-server').deploy(makeChannel()).catch((e: unknown) => e);

    expect(isServiceError(error, 'INVALID_INPUT')).toBe(true);
    expect((error as Error).message).toMatch(/^Script global\/deploy\.ts failed to compile/);
  });

  it('reports a rule the engine cannot run as invalid input', async () => {
    filterRows = [filterRow({ type: 'RULE_BUILDER', field: 'MSH.9.1', condition: 'EQUALS', values: [] })];

    const error: unknown = await new EngineManager('test-server').deploy(makeChannel()).catch((e: unknown) => e);

    expect(isServiceError(error, 'INVALID_INPUT')).toBe(true);
  });

  it('deploys a Rule Builder rule as a running filter', async () => {
    filterRows = [filterRow({ type: 'RULE_BUILDER', field: 'MSH.9.1', condition: 'EQUALS', values: ['ADT'] })];

    const engine = new EngineManager('test-server');
    await engine.deploy(makeChannel());

    expect(engine.getRuntime(CHANNEL_ID)?.scripts.sourceFilter?.code).toContain('"MSH.9.1"');
  });

  it('ignores a disabled rule that would not compile to anything', async () => {
    filterRows = [filterRow({ type: 'RULE_BUILDER', enabled: false })];

    expect(await deployError()).toBe('deployed');
  });

  it.each([
    ['code templates', (): void => { mockListTemplates.mockResolvedValue(DB_DOWN); }],
    ['global scripts', (): void => { mockGlobalScriptGetAll.mockResolvedValue(DB_DOWN); }],
    ['the configuration map', (): void => { mockConfigMapList.mockResolvedValue(DB_DOWN); }],
    ['the global map', (): void => { mockGlobalMapList.mockResolvedValue(DB_DOWN); }],
  ])('fails when %s cannot be loaded', async (what, breakIt) => {
    breakIt();

    expect(await deployError()).toBe(`Channel ${CHANNEL_ID} cannot deploy: failed to load ${what}: connection refused`);
  });
});

describe('EngineManager.deploy of one channel twice at once', () => {
  it('rejects the second request while the first is still deploying', async () => {
    const engine = new EngineManager('test-server');

    const outcomes = await Promise.allSettled([engine.deploy(makeChannel()), engine.deploy(makeChannel())]);

    expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'rejected']);
    expect((outcomes[1] as PromiseRejectedResult).reason).toHaveProperty('message', `Channel ${CHANNEL_ID} is already being deployed`);
  });

  it('allows a new deploy after a failed one', async () => {
    transformerRows = [stepRow({ script: 'msg.delete("PID.19"' })];
    const engine = new EngineManager('test-server');
    await expect(engine.deploy(makeChannel())).rejects.toThrow();

    transformerRows = [];
    await expect(engine.deploy(makeChannel())).resolves.toBeUndefined();
  });
});
