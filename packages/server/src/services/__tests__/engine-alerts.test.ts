import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

const alerts = vi.hoisted(() => ({ listEnabled: vi.fn(), onChange: vi.fn(), sendMail: vi.fn() }));
vi.mock('../alert.service.js', () => ({ AlertService: { listEnabled: alerts.listEnabled, onChange: alerts.onChange } }));
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

function alertDetail(action: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'a1', name: 'Errors', enabled: true, channelIds: [CHANNEL_ID],
    trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null },
    actions: [{ id: 'act1', recipients: [], properties: null, ...action }],
    subjectTemplate: null, bodyTemplate: 'ALERT ${errorMessage}', reAlertIntervalMs: null, maxAlerts: null,
  };
}

function alertWith(action: Record<string, unknown>): void {
  alerts.listEnabled.mockResolvedValue(ok([alertDetail(action)]));
}

const EMAIL = { actionType: 'EMAIL', recipients: ['oncall@example.org'] };

/** As AlertService does after a change is saved. */
function alertsChanged(): void {
  (alerts.onChange.mock.lastCall![0] as () => void)();
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

async function sentToTarget(): Promise<string> {
  await vi.waitFor(() => { expect(ms.initializeMessage).toHaveBeenCalledTimes(2); }, WAIT);
  const call = ms.initializeMessage.mock.calls.find((c: unknown[]) => c[0] === TARGET_ID)!;
  return (call[3] as Array<{ content: string }>)[0]!.content;
}

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
    alerts.listEnabled.mockResolvedValue(OK_EMPTY);
    await engine.deploy(bundleOf(makeChannel({ id: TARGET_ID, name: 'Alert sink', inboundDataType: 'RAW', outboundDataType: 'RAW' })));
    await engine.getRuntime(TARGET_ID)!.runtime.start();

    await engine.getRuntime(CHANNEL_ID)!.processMessage('x');

    expect(await sentToTarget()).toContain('ALERT Script error in preprocessor');
    await engine.dispose();
  });

  // PostgreSQL text cannot hold U+0000, and a reason can: that of an MLLP NAK, say (#417, D-367).
  it.each([
    ['as U+2400 to a channel that stores plain text', {}, 'MSA|AE|\u2400MRN-8675309', 1],
    ['as it is to a channel that encrypts its content', { encryptData: true }, 'MSA|AE|\u0000MRN-8675309', 0],
    ['as it is to a channel that does not store its content', { messageStorageMode: 'METADATA' }, 'MSA|AE|\u0000MRN-8675309', 0],
  ])('delivers U+0000 in an alert %s', async (_how, target, text, warnings) => {
    const logger = (await import('../../lib/logger.js')).default;
    const seen: string[] = [];
    alertWith({ actionType: 'CHANNEL', properties: { channelId: TARGET_ID } });
    const engine = new EngineManager('test-server');
    await engine.deploy(bundleOf(makeChannel({ ...FAILING, scripts: [{ scriptType: 'PREPROCESSOR', script: 'throw new Error("MSA|AE|\\u0000MRN-8675309");' }] })));
    alerts.listEnabled.mockResolvedValue(OK_EMPTY);
    await engine.deploy(bundleOf(makeChannel({ id: TARGET_ID, name: 'Alert sink', inboundDataType: 'RAW', outboundDataType: 'RAW' })));
    await engine.getRuntime(TARGET_ID)!.runtime.start();
    const sink = engine.getRuntime(TARGET_ID)!;
    Object.assign(sink, {
      config: { ...sink.config, ...target },
      processMessage: async (content: string) => { seen.push(content); return ok({ messageId: 1, status: 'PROCESSED' }); },
    });

    await engine.getRuntime(CHANNEL_ID)!.processMessage('x');

    await vi.waitFor(() => { expect(seen).toHaveLength(1); }, WAIT);
    expect(seen[0]).toContain(text);
    const warned = vi.mocked(logger.warn).mock.calls.filter(([, line]) => String(line).startsWith('An alert holds U+0000'));
    expect(warned.map(([fields]) => fields)).toEqual(warnings === 0 ? [] : [{ channelId: CHANNEL_ID, targetChannelId: TARGET_ID }]);
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

describe('a change to an alert, on a channel that is running (#417)', () => {
  let engine: InstanceType<typeof EngineManager>;

  beforeEach(async () => {
    alerts.listEnabled.mockResolvedValue(OK_EMPTY);
    engine = new EngineManager('test-server');
    await engine.deploy(bundleOf(makeChannel(FAILING)));
  });

  afterEach(async () => {
    await engine.dispose();
  });

  const loaded = (): readonly { readonly id: string }[] => engine.getRuntime(CHANNEL_ID)!.alertManager.getAlerts();

  it('is in force without a redeploy when the alert is created', async () => {
    alertWith(EMAIL);
    alertsChanged();
    await vi.waitFor(() => { expect(loaded()).toHaveLength(1); }, WAIT);

    await engine.getRuntime(CHANNEL_ID)!.processMessage('x');

    await vi.waitFor(() => { expect(alerts.sendMail).toHaveBeenCalledTimes(1); }, WAIT);
  });

  it('is in force without a redeploy when the alert is disabled or deleted', async () => {
    alertWith(EMAIL);
    alertsChanged();
    await vi.waitFor(() => { expect(loaded()).toHaveLength(1); }, WAIT);

    alerts.listEnabled.mockResolvedValue(OK_EMPTY);
    alertsChanged();
    await vi.waitFor(() => { expect(loaded()).toHaveLength(0); }, WAIT);

    await engine.getRuntime(CHANNEL_ID)!.processMessage('x');
    expect(alerts.sendMail).not.toHaveBeenCalled();
  });

  it('does not reach a channel the alert does not name', async () => {
    alerts.listEnabled.mockResolvedValue(ok([{ ...alertDetail(EMAIL), channelIds: [TARGET_ID] }, { ...alertDetail(EMAIL), id: 'a2', channelIds: [] }]));
    alertsChanged();

    await vi.waitFor(() => { expect(loaded().map((a) => a.id)).toEqual(['a2']); }, WAIT);
  });

  it('leaves the alerts as they were when they cannot be read, says so, and takes the change at the next check', async () => {
    const logger = (await import('../../lib/logger.js')).default;
    alertWith(EMAIL);
    alertsChanged();
    await vi.waitFor(() => { expect(loaded()).toHaveLength(1); }, WAIT);

    alerts.listEnabled.mockResolvedValueOnce({ ok: false, value: null, error: new Error('db down') });
    alertsChanged();
    await vi.waitFor(() => { expect(logger.error).toHaveBeenCalledWith({ errMsg: 'db down' }, expect.stringContaining('alerts')); }, WAIT);
    expect(loaded()).toHaveLength(1);

    alerts.listEnabled.mockResolvedValue(OK_EMPTY);
    await engine.checkSilentChannels();

    expect(loaded()).toHaveLength(0);
  });

  it('reads the alerts for the checks only when a change is outstanding', async () => {
    alerts.listEnabled.mockClear();

    await engine.checkSilentChannels();

    expect(alerts.listEnabled).not.toHaveBeenCalled();
  });

  it('is in force on a channel that was being deployed when it was made', async () => {
    let release: (value: unknown) => void = () => undefined;
    alerts.listEnabled.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const deploying = engine.deploy(bundleOf(makeChannel({ id: TARGET_ID, name: 'Second' })));
    await vi.waitFor(() => { expect(alerts.listEnabled).toHaveBeenCalledTimes(2); }, WAIT);

    alerts.listEnabled.mockResolvedValue(ok([{ ...alertDetail(EMAIL), channelIds: [] }]));
    alertsChanged();
    await vi.waitFor(() => { expect(loaded()).toHaveLength(1); }, WAIT);
    release(OK_EMPTY);
    await deploying;

    expect(engine.getRuntime(TARGET_ID)!.alertManager.getAlerts()).toHaveLength(1);
  });

  it('reads the alerts once more, not once for each, when many changes come at once', async () => {
    alerts.listEnabled.mockClear();
    let release: (value: unknown) => void = () => undefined;
    alerts.listEnabled.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    alertsChanged();
    await vi.waitFor(() => { expect(alerts.listEnabled).toHaveBeenCalledTimes(1); }, WAIT);

    alertWith(EMAIL);
    for (let i = 0; i < 50; i++) alertsChanged();
    release(OK_EMPTY);

    await vi.waitFor(() => { expect(loaded()).toHaveLength(1); }, WAIT);
    expect(alerts.listEnabled).toHaveBeenCalledTimes(2);
  });
});
