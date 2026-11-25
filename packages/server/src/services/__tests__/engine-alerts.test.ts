import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bundleOf } from '../../../test/deployment-bundle.js';

const mockSend = vi.hoisted(() => vi.fn());

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

const alerts = vi.hoisted(() => ({ list: vi.fn(), getByIds: vi.fn(), sendMail: vi.fn() }));
vi.mock('../alert.service.js', () => ({ AlertService: { list: alerts.list, getByIds: alerts.getByIds } }));
vi.mock('../email.service.js', () => ({ EmailService: { sendMail: alerts.sendMail } }));

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
const TARGET_ID = '00000000-0000-0000-0000-000000000002';

function alertWith(action: Record<string, unknown>): void {
  const detail = {
    id: 'a1', name: 'Errors', enabled: true, channelIds: [CHANNEL_ID],
    trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null },
    actions: [{ id: 'act1', recipients: [], properties: null, ...action }],
    subjectTemplate: null, bodyTemplate: 'ALERT ${errorMessage}', reAlertIntervalMs: null, maxAlerts: null,
  };
  alerts.list.mockResolvedValue(ok({ data: [detail], pagination: { page: 1, pageSize: 1000, total: 1, totalPages: 1 } }));
  alerts.getByIds.mockResolvedValue(ok([detail]));
}

const FAILING = { inboundDataType: 'RAW', outboundDataType: 'RAW', scripts: [{ scriptType: 'PREPROCESSOR', script: 'throw new Error("boom");' }] };

beforeEach(() => {
  vi.clearAllMocks();
  mockConfigMapList.mockResolvedValue(OK_EMPTY);
  mockGlobalMapList.mockResolvedValue(OK_EMPTY);
  mockSend.mockResolvedValue(ok({ status: 'SENT', content: 'ACK' }));
  for (const fn of Object.values(ms)) fn.mockResolvedValue(OK);
  ms.getLatestMessageId.mockResolvedValue(ok(0));
  ms.waitingByDestination.mockResolvedValue(ok([]));
  ms.initializeMessage.mockResolvedValue(ok({ messageId: 99, correlationId: '00000000-0000-0000-0000-000000000099' }));
  alerts.sendMail.mockResolvedValue(OK);
});

/** Generous: delivery runs a deploy and a second channel, which takes seconds on a loaded machine (#125). */
const WAIT = { timeout: 10_000 };

describe('EngineManager alerts', () => {
  it('does not hold a message up while the alert email is being sent', async () => {
    alertWith({ actionType: 'EMAIL', recipients: ['oncall@example.org'] });
    alerts.sendMail.mockImplementation(() => new Promise(() => undefined)); // SMTP server that never answers
    const engine = new EngineManager('test-server');
    await engine.deploy(bundleOf(makeChannel(FAILING)));

    // The email never finishes, so a message that waited on it would never return here.
    const result = await engine.getRuntime(CHANNEL_ID)!.processMessage('x');

    expect(result.ok && result.value.status).toBe('ERROR');
    expect(alerts.sendMail).toHaveBeenCalledTimes(1);
    await engine.dispose();
  });

  it('delivers a CHANNEL alert action to the target channel', async () => {
    alertWith({ actionType: 'CHANNEL', properties: { channelId: TARGET_ID } });
    const engine = new EngineManager('test-server');
    await engine.deploy(bundleOf(makeChannel(FAILING)));
    alerts.list.mockResolvedValue(ok({ data: [], pagination: { page: 1, pageSize: 1000, total: 0, totalPages: 0 } }));
    await engine.deploy(bundleOf(makeChannel({ id: TARGET_ID, name: 'Alert sink', inboundDataType: 'RAW', outboundDataType: 'RAW' })));
    await engine.getRuntime(TARGET_ID)!.runtime.start();

    await engine.getRuntime(CHANNEL_ID)!.processMessage('x');
    await vi.waitFor(() => { expect(ms.initializeMessage).toHaveBeenCalledTimes(2); }, WAIT);

    const sinkCall = ms.initializeMessage.mock.calls.find((c: unknown[]) => c[0] === TARGET_ID)!;
    expect((sinkCall[3] as Array<{ content: string }>)[0]!.content).toContain('ALERT Script error in preprocessor');
    await engine.dispose();
  });

  it('warns instead of sending when the target channel is not running', async () => {
    const logger = (await import('../../lib/logger.js')).default;
    alertWith({ actionType: 'CHANNEL', properties: { channelId: TARGET_ID } });
    const engine = new EngineManager('test-server');
    await engine.deploy(bundleOf(makeChannel(FAILING)));

    await engine.getRuntime(CHANNEL_ID)!.processMessage('x');

    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ targetChannelId: TARGET_ID }), expect.stringContaining('Failed to dispatch alert'));
    }, WAIT);
    await engine.dispose();
  });

  it('never sends an alert about a channel into that same channel', async () => {
    alertWith({ actionType: 'CHANNEL', properties: { channelId: CHANNEL_ID } });
    const engine = new EngineManager('test-server');
    await engine.deploy(bundleOf(makeChannel(FAILING)));
    await engine.getRuntime(CHANNEL_ID)!.runtime.start();

    await engine.getRuntime(CHANNEL_ID)!.processMessage('x');
    await new Promise((resolve) => { setTimeout(resolve, 20); });

    expect(ms.initializeMessage).toHaveBeenCalledTimes(1);
    await engine.dispose();
  });
});
