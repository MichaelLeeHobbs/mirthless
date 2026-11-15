// ===========================================
// Engine Source Failure Tests
// ===========================================
// A source that stops itself (a Kafka record or AMQP message the store always
// rejects) stops its channel, records an ERROR event and raises a
// SOURCE_CONNECTOR alert. Real engine package; fake database, services and
// connectors.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock Dependencies -----

const OK_RESULT = { ok: true, value: undefined, error: null };
const source = vi.hoisted(() => ({
  fatal: null as ((error: Error) => void) | null,
}));
const sourceMock = vi.hoisted(() => ({
  setDispatcher: vi.fn(),
  setFatalHandler: vi.fn(),
  onDeploy: vi.fn(),
  onStart: vi.fn(),
  onStop: vi.fn(),
  onHalt: vi.fn(),
  onUndeploy: vi.fn(),
}));

vi.mock('@galvaniflow/connectors', () => ({
  createSourceConnector: vi.fn().mockReturnValue(sourceMock),
  createDestinationConnector: vi.fn(),
  JavaScriptReceiver: vi.fn(),
  JavaScriptDispatcher: vi.fn(),
  DISPATCH_STATUS: { PROCESSED: 'PROCESSED', FILTERED: 'FILTERED', ERROR: 'ERROR' },
}));

const ms = vi.hoisted(() => ({
  getLatestMessageId: vi.fn(),
  resetPending: vi.fn(),
}));
vi.mock('../message.service.js', () => ({ MessageService: ms }));

const ok = <T>(value: T): { ok: true; value: T; error: null } => ({ ok: true, value, error: null });
const OK_EMPTY = ok([]);

vi.mock('../global-map.service.js', () => ({
  GlobalMapService: { list: vi.fn().mockResolvedValue(OK_EMPTY), persist: vi.fn(), persistRemoval: vi.fn(), onChange: vi.fn() },
}));
vi.mock('../config-map.service.js', () => ({ ConfigMapService: { list: vi.fn().mockResolvedValue(OK_EMPTY) } }));
vi.mock('../code-template.service.js', () => ({ CodeTemplateService: { listTemplatesForChannel: vi.fn().mockResolvedValue(OK_EMPTY) } }));
vi.mock('../global-script.service.js', () => ({
  GlobalScriptService: { getAll: vi.fn().mockResolvedValue(ok({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' })) },
}));

const alerts = vi.hoisted(() => ({ list: vi.fn(), getByIds: vi.fn(), sendMail: vi.fn() }));
vi.mock('../alert.service.js', () => ({ AlertService: { list: alerts.list, getByIds: alerts.getByIds } }));
vi.mock('../email.service.js', () => ({ EmailService: { sendMail: alerts.sendMail } }));

const events = vi.hoisted(() => ({ emitEvent: vi.fn(), emitToAll: vi.fn() }));
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: events.emitEvent }));
vi.mock('../../lib/socket.js', () => ({ emitToAll: events.emitToAll }));

const mockSelect = vi.fn();
vi.mock('../../lib/db.js', () => ({ db: { select: mockSelect } }));
vi.mock('../../db/schema/index.js', () => ({
  channelFilters: { id: 'id', channelId: 'channelId', connectorId: 'connectorId' },
  filterRules: { id: 'id', filterId: 'filterId', sequenceNumber: 'sequenceNumber', enabled: 'enabled', operator: 'operator', type: 'type', script: 'script' },
  channelTransformers: { id: 'id', channelId: 'channelId', connectorId: 'connectorId' },
  transformerSteps: { id: 'id', transformerId: 'transformerId', sequenceNumber: 'sequenceNumber', enabled: 'enabled', type: 'type', script: 'script' },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), asc: vi.fn() }));
vi.mock('../../lib/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../config/index.js', () => ({ config: { LOG_LEVEL: 'info', NODE_ENV: 'test' } }));

// Must import after mocks
const { EngineManager } = await import('../../engine.js');

// ----- Fixtures -----

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';

const CHANNEL = {
  id: CHANNEL_ID,
  name: 'ADT from Kafka',
  enabled: true,
  sourceConnectorType: 'KAFKA',
  sourceConnectorProperties: { brokers: 'kafka:9092', topic: 'adt', groupId: 'g' },
  inboundDataType: 'RAW',
  outboundDataType: 'RAW',
  messageStorageMode: 'DEVELOPMENT',
  metadataColumns: [],
  destinations: [],
  scripts: [],
} as never;

function alertOnSourceErrors(): void {
  const detail = {
    id: 'a1', name: 'Source down', enabled: true, channelIds: [CHANNEL_ID],
    trigger: { type: 'CHANNEL_ERROR', errorTypes: ['SOURCE_CONNECTOR'], regex: null },
    actions: [{ id: 'act1', actionType: 'EMAIL', recipients: ['oncall@example.org'], properties: null }],
    subjectTemplate: null, bodyTemplate: 'ALERT ${errorMessage}', reAlertIntervalMs: null, maxAlerts: null,
  };
  alerts.list.mockResolvedValue(ok({ data: [detail], pagination: { page: 1, pageSize: 1000, total: 1, totalPages: 1 } }));
  alerts.getByIds.mockResolvedValue(ok([detail]));
}

beforeEach(() => {
  vi.clearAllMocks();
  source.fatal = null;
  for (const fn of [sourceMock.onDeploy, sourceMock.onStart, sourceMock.onStop, sourceMock.onHalt, sourceMock.onUndeploy]) {
    fn.mockResolvedValue(OK_RESULT);
  }
  sourceMock.setFatalHandler.mockImplementation((handler: (error: Error) => void) => { source.fatal = handler; });
  mockSelect.mockImplementation(() => ({ from: () => ({ leftJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }) }) }));
  ms.getLatestMessageId.mockResolvedValue(ok(0));
  ms.resetPending.mockResolvedValue(OK_RESULT);
  alerts.sendMail.mockResolvedValue(OK_RESULT);
  alertOnSourceErrors();
});

describe('EngineManager source failure', () => {
  it('stops the channel, records an ERROR event and raises a SOURCE_CONNECTOR alert', async () => {
    const engine = new EngineManager('test-server');
    await engine.deploy(CHANNEL);
    const deployed = engine.getRuntime(CHANNEL_ID)!;
    await deployed.runtime.start();
    expect(source.fatal).not.toBeNull();

    source.fatal?.(new Error('Kafka source stopped: the channel could not store the record at offset 7 after 5 attempts'));

    await vi.waitFor(() => { expect(deployed.runtime.getState()).toBe('STOPPED'); });
    expect(sourceMock.onStop).toHaveBeenCalledTimes(1);
    expect(events.emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: 'ERROR', name: 'CHANNEL_STOPPED', outcome: 'FAILURE', channelId: CHANNEL_ID,
      attributes: expect.objectContaining({ reason: 'SOURCE_FAILED', error: expect.stringContaining('offset 7') }),
    }));
    expect(events.emitToAll).toHaveBeenCalledWith('channel:state', { channelId: CHANNEL_ID, state: 'STOPPED' });
    await vi.waitFor(() => { expect(alerts.sendMail).toHaveBeenCalledTimes(1); });
    expect(alerts.sendMail.mock.calls[0]?.[2]).toContain('offset 7');
    await engine.dispose();
  });

  it('records the event and alert but leaves a channel that is already stopped alone', async () => {
    const engine = new EngineManager('test-server');
    await engine.deploy(CHANNEL);

    source.fatal?.(new Error('AMQP source stopped'));

    await vi.waitFor(() => { expect(alerts.sendMail).toHaveBeenCalledTimes(1); });
    expect(events.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ level: 'ERROR', channelId: CHANNEL_ID }));
    expect(sourceMock.onStop).not.toHaveBeenCalled();
    expect(engine.getRuntime(CHANNEL_ID)!.runtime.getState()).toBe('STOPPED');
    await engine.dispose();
  });
});
