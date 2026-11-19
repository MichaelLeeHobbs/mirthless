// A channel must never start with fewer scripts than it was configured with.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isServiceError } from '../../lib/service-error.js';
import type { DeploymentBundle } from '../deployment-record.service.js';
import { bundleOf, deployedTemplate } from '../../../test/deployment-bundle.js';

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
  config: { LOG_LEVEL: 'info', NODE_ENV: 'test', FILE_CONNECTOR_ROOTS: ['/srv/files'] },
}));

// Must import after mocks
const { EngineManager } = await import('../../engine.js');

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
    filters: [],
    transformers: [],
    ...overrides,
  } as never;
}

/** A source filter rule as the channel carries it. */
function rule(fields: Record<string, unknown>, index = 0): Record<string, unknown> {
  return {
    id: `r${String(index)}`, sequenceNumber: index, enabled: true, name: null, operator: 'AND', type: 'JAVASCRIPT',
    script: null, language: 'JAVASCRIPT', field: null, condition: null, values: null,
    ...fields,
  };
}

/** A source transformer step as the channel carries it. */
function step(fields: Record<string, unknown>, index = 0): Record<string, unknown> {
  return {
    id: `s${String(index)}`, sequenceNumber: index, enabled: true, name: null, type: 'JAVASCRIPT', script: null,
    language: 'JAVASCRIPT', sourceField: null, targetField: null, defaultValue: null, mapping: null,
    ...fields,
  };
}

/** Channel overrides giving the source these filter rules. */
function sourceFilter(...rules: Record<string, unknown>[]): Record<string, unknown> {
  return { filters: [{ id: 'f1', connectorId: null, rules }] };
}

/** Channel overrides giving the source these transformer steps. */
function sourceTransformer(...steps: Record<string, unknown>[]): Record<string, unknown> {
  return {
    transformers: [{
      id: 't1', connectorId: null, inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: {},
      outboundProperties: {}, inboundTemplate: null, outboundTemplate: null, steps,
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGlobalMapList.mockResolvedValue(OK_EMPTY);
  mockConfigMapList.mockResolvedValue(OK_EMPTY);
});

async function deployError(bundle: DeploymentBundle = bundleOf(makeChannel())): Promise<string> {
  const engine = new EngineManager('test-server');
  const outcome = await engine.deploy(bundle).then(() => 'deployed', (e: unknown) => (e as Error).message);
  if (outcome !== 'deployed') expect(engine.getRuntime(CHANNEL_ID)).toBeUndefined();
  return outcome;
}

describe('EngineManager.deploy refuses to start a channel it cannot run as configured', () => {
  it('refuses a channel that responds from a destination it does not have (renamed or removed)', async () => {
    const engine = new EngineManager('test-server');
    await expect(engine.deploy(bundleOf(makeChannel({ responseMode: 'DESTINATION', responseConnectorName: 'Old Name' }))))
      .rejects.toThrow('responds from destination "Old Name", which it does not have');
  });

  it('refuses batch processing on a data type it cannot split', async () => {
    const engine = new EngineManager('test-server');
    await expect(engine.deploy(bundleOf(makeChannel({ inboundDataType: 'JSON', sourceConnectorProperties: { port: 6661, processBatch: true } }))))
      .rejects.toThrow('batch processing is only supported for HL7V2, not JSON');
  });

  it('deploys a channel whose scripts all compile', async () => {
    const channel = makeChannel({
      ...sourceFilter(rule({ script: 'return msg.get("MSH.9.1") === "ADT";' })),
      ...sourceTransformer(step({ script: 'msg.delete("PID.19");' })),
    });

    const engine = new EngineManager('test-server');
    await engine.deploy(bundleOf(channel));

    const scripts = engine.getRuntime(CHANNEL_ID)?.scripts;
    expect(scripts?.sourceFilter?.code).toContain('MSH.9.1');
    expect(scripts?.sourceTransformer?.code).toContain('PID.19');
  });

  it('fails when a source filter rule has a syntax error', async () => {
    const channel = makeChannel(sourceFilter(rule({ script: 'return msg.get("MSH.9.1" === ;' })));

    expect(await deployError(bundleOf(channel))).toMatch(/^Script Labs\/sourceFilter\.ts failed to compile/);
  });

  it('fails when a source transformer step has a syntax error', async () => {
    const channel = makeChannel(sourceTransformer(step({ script: 'msg.delete("PID.19"' })));

    expect(await deployError(bundleOf(channel))).toMatch(/^Script Labs\/sourceTransformer\.ts failed to compile/);
  });

  it('fails when a channel preprocessor has a syntax error', async () => {
    const channel = makeChannel({ scripts: [{ scriptType: 'PREPROCESSOR', script: 'return ((;' }] });

    expect(await deployError(bundleOf(channel))).toMatch(/^Script Labs\/preprocessor\.ts failed to compile/);
  });

  it('fails when a global script has a syntax error', async () => {
    const bundle = bundleOf(makeChannel(), { globalScripts: { preprocessor: 'function {' } });

    expect(await deployError(bundle)).toMatch(/^Script global\/preprocessor\.ts failed to compile/);
  });

  it('fails when a code template breaks an otherwise valid filter', async () => {
    const bundle = bundleOf(makeChannel(sourceFilter(rule({ script: 'return true;' }))), {
      templates: [deployedTemplate({ code: 'function broken( {', type: 'FUNCTION', contexts: ['SOURCE_FILTER_TRANSFORMER'] })],
    });

    expect(await deployError(bundle)).toContain('failed to compile (it includes the code templates for sourceFilter)');
  });

  it('fails when an enabled Mapper step has nothing the engine can run', async () => {
    const channel = makeChannel(sourceTransformer(step({ script: 'msg.delete("PID.19");' }), step({ type: 'MAPPER' }, 1)));

    expect(await deployError(bundleOf(channel))).toBe('Labs source transformer: Transformer step 2 has type MAPPER, which this engine cannot run');
  });

  it('fails when a Rule Builder rule is incomplete', async () => {
    const channel = makeChannel(sourceFilter(rule({ type: 'RULE_BUILDER', field: 'MSH.9.1', condition: 'EQUALS', values: [] })));

    expect(await deployError(bundleOf(channel))).toBe('Labs source filter: Filter rule 1 (Rule Builder) needs at least one value for EQUALS');
  });

  it('reports a script that will not compile as invalid input, so the API can say why', async () => {
    const bundle = bundleOf(makeChannel(), { globalScripts: { deploy: "logger.info('x');/ E2E test" } });

    const error: unknown = await new EngineManager('test-server').deploy(bundle).catch((e: unknown) => e);

    expect(isServiceError(error, 'INVALID_INPUT')).toBe(true);
    expect((error as Error).message).toMatch(/^Script global\/deploy\.ts failed to compile/);
  });

  it('reports a rule the engine cannot run as invalid input', async () => {
    const channel = makeChannel(sourceFilter(rule({ type: 'RULE_BUILDER', field: 'MSH.9.1', condition: 'EQUALS', values: [] })));

    const error: unknown = await new EngineManager('test-server').deploy(bundleOf(channel)).catch((e: unknown) => e);

    expect(isServiceError(error, 'INVALID_INPUT')).toBe(true);
  });

  it('deploys a Rule Builder rule as a running filter', async () => {
    const channel = makeChannel(sourceFilter(rule({ type: 'RULE_BUILDER', field: 'MSH.9.1', condition: 'EQUALS', values: ['ADT'] })));

    const engine = new EngineManager('test-server');
    await engine.deploy(bundleOf(channel));

    expect(engine.getRuntime(CHANNEL_ID)?.scripts.sourceFilter?.code).toContain('"MSH.9.1"');
  });

  it('ignores a disabled rule that would not compile to anything', async () => {
    const channel = makeChannel(sourceFilter(rule({ type: 'RULE_BUILDER', enabled: false })));

    expect(await deployError(bundleOf(channel))).toBe('deployed');
  });

  it.each([
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

    const outcomes = await Promise.allSettled([engine.deploy(bundleOf(makeChannel())), engine.deploy(bundleOf(makeChannel()))]);

    expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'rejected']);
    expect((outcomes[1] as PromiseRejectedResult).reason).toHaveProperty('message', `Channel ${CHANNEL_ID} is already being deployed`);
  });

  it('allows a new deploy after a failed one', async () => {
    const engine = new EngineManager('test-server');
    await expect(engine.deploy(bundleOf(makeChannel(sourceTransformer(step({ script: 'msg.delete("PID.19"' })))))).rejects.toThrow();

    await expect(engine.deploy(bundleOf(makeChannel()))).resolves.toBeUndefined();
  });
});

// GHSA-r434-hwqg-cvcw: without the roots a File connector refuses every path,
// so this is what makes FILE_CONNECTOR_ROOTS reach the File source and destination.
describe('EngineManager.deploy passes the File roots to the connectors it builds', () => {
  it('gives the source and each destination FILE_CONNECTOR_ROOTS and the server directories', async () => {
    const { createSourceConnector, createDestinationConnector } = await import('@galvanigraph/connectors');
    const { INSTALL_ROOT } = await import('../../lib/file-roots.js');
    const env = { fileRoots: { allowed: ['/srv/files'], denied: [INSTALL_ROOT, process.cwd()] } };

    await new EngineManager('test-server').deploy(bundleOf(makeChannel({
      sourceConnectorType: 'FILE',
      sourceConnectorProperties: { directory: '/srv/files/in' },
      destinations: [{
        metaDataId: 1, name: 'Out', enabled: true, connectorType: 'FILE', properties: { directory: '/srv/files/out' },
        queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 0, rotateQueue: false,
      }],
    })));

    expect(vi.mocked(createSourceConnector)).toHaveBeenLastCalledWith(expect.any(String), expect.anything(), env);
    expect(vi.mocked(createDestinationConnector)).toHaveBeenLastCalledWith(expect.any(String), expect.anything(), env);
  });
});

describe('EngineManager.deploy with a connector that cannot be built', () => {
  it('fails the deploy with the connector error and registers no runtime', async () => {
    // The real factory: which check refuses a non-object tls is its business;
    // the deploy must fail with that error and keep no runtime.
    const actual = await vi.importActual<typeof import('@galvanigraph/connectors')>('@galvanigraph/connectors');
    const props = { port: 6661, tls: 'abc' };
    let factoryError = '';
    try {
      actual.createSourceConnector('TCP_MLLP', props);
    } catch (err) {
      factoryError = err instanceof Error ? err.message : String(err);
    }
    expect(factoryError).toMatch(/tls/i);

    const { createSourceConnector } = await import('@galvanigraph/connectors');
    vi.mocked(createSourceConnector).mockImplementationOnce((type, p) => actual.createSourceConnector(type, p));
    expect(await deployError(bundleOf(makeChannel({ sourceConnectorProperties: props })))).toBe(factoryError);
  });
});
