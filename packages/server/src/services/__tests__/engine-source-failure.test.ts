// A source that fails: one that stops itself (the store always rejects a Kafka record or AMQP message), and one that goes on trying.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DeployedChannel } from '../../engine.js';
import { bundleOf } from '../../../test/deployment-bundle.js';

const OK_RESULT = { ok: true, value: undefined, error: null };
const source = vi.hoisted(() => ({
  fatal: null as ((error: Error) => void) | null,
  health: null as ((failure: Error | null) => void) | null,
}));
const sourceMock = vi.hoisted(() => ({
  setDispatcher: vi.fn(),
  setFatalHandler: vi.fn(),
  setHealthHandler: vi.fn(),
  onDeploy: vi.fn(),
  onStart: vi.fn(),
  onStop: vi.fn(),
  onHalt: vi.fn(),
  onUndeploy: vi.fn(),
}));

vi.mock('@galvanigraph/connectors', () => ({
  createSourceConnector: vi.fn().mockReturnValue(sourceMock),
  createDestinationConnector: vi.fn(),
  JavaScriptReceiver: vi.fn(),
  JavaScriptDispatcher: vi.fn(),
  DISPATCH_STATUS: { PROCESSED: 'PROCESSED', FILTERED: 'FILTERED', ERROR: 'ERROR' },
}));

const ms = vi.hoisted(() => ({
  getLatestMessageId: vi.fn(),
  resetPending: vi.fn(),
  waitingByDestination: vi.fn(),
}));
vi.mock('../message.service.js', () => ({ MessageService: ms }));

const ok = <T>(value: T): { ok: true; value: T; error: null } => ({ ok: true, value, error: null });
const OK_EMPTY = ok([]);

vi.mock('../global-map.service.js', () => ({
  GlobalMapService: { list: vi.fn().mockResolvedValue(OK_EMPTY), persist: vi.fn(), persistRemoval: vi.fn(), onChange: vi.fn() },
}));
vi.mock('../config-map.service.js', () => ({ ConfigMapService: { list: vi.fn().mockResolvedValue(OK_EMPTY) } }));

const alerts = vi.hoisted(() => ({ listEnabled: vi.fn(), onChange: vi.fn(), sendMail: vi.fn() }));
vi.mock('../alert.service.js', () => ({ AlertService: { listEnabled: alerts.listEnabled, onChange: alerts.onChange } }));
vi.mock('../email.service.js', () => ({ EmailService: { sendMail: alerts.sendMail } }));

const events = vi.hoisted(() => ({ emitEvent: vi.fn(), emitToAll: vi.fn() }));
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: events.emitEvent }));
vi.mock('../../lib/socket.js', () => ({ emitToChannelAudience: events.emitToAll }));

vi.mock('../../lib/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../config/index.js', () => ({ config: { LOG_LEVEL: 'info', NODE_ENV: 'test' } }));

// Must import after mocks
const { EngineManager } = await import('../../engine.js');
const { createDestinationConnector } = await import('@galvanigraph/connectors');

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
  filters: [],
  transformers: [],
} as never;
const BUNDLE = bundleOf(CHANNEL);

const QUEUED_BUNDLE = bundleOf({
  ...(CHANNEL as object),
  destinations: [{
    id: 'dest-1', metaDataId: 1, name: 'Queued', enabled: true, connectorType: 'TCP_MLLP', properties: {}, queueMode: 'ALWAYS',
  }],
} as never);

function alertOnSourceErrors(reAlertIntervalMs: number | null = null): void {
  const detail = {
    id: 'a1', name: 'Source down', enabled: true, channelIds: [CHANNEL_ID],
    trigger: { type: 'CHANNEL_ERROR', errorTypes: ['SOURCE_CONNECTOR'], regex: null },
    actions: [{ id: 'act1', actionType: 'EMAIL', recipients: ['oncall@example.org'], properties: null }],
    subjectTemplate: null, bodyTemplate: 'ALERT ${errorMessage}', reAlertIntervalMs, maxAlerts: null,
  };
  alerts.listEnabled.mockResolvedValue(ok([detail]));
}

beforeEach(() => {
  vi.clearAllMocks();
  source.fatal = null;
  for (const fn of [sourceMock.onDeploy, sourceMock.onStart, sourceMock.onStop, sourceMock.onHalt, sourceMock.onUndeploy]) {
    fn.mockResolvedValue(OK_RESULT);
  }
  sourceMock.setFatalHandler.mockImplementation((handler: (error: Error) => void) => { source.fatal = handler; });
  sourceMock.setHealthHandler.mockImplementation((handler: (failure: Error | null) => void) => { source.health = handler; });
  ms.getLatestMessageId.mockResolvedValue(ok(0));
  ms.resetPending.mockResolvedValue(OK_RESULT);
  ms.waitingByDestination.mockResolvedValue(ok([]));
  alerts.sendMail.mockResolvedValue(OK_RESULT);
  alertOnSourceErrors();
});

/** Generous, so a loaded machine cannot fail a wait that would succeed (#125). */
const WAIT = { timeout: 10_000 };

describe('a source that cannot poll, or has lost its partner (#417)', () => {
  const DOWN = new Error('connect ECONNREFUSED');
  let engine: InstanceType<typeof EngineManager>;

  async function running(): Promise<DeployedChannel> {
    await engine.deploy(BUNDLE);
    const deployed = engine.getRuntime(CHANNEL_ID)!;
    await deployed.runtime.start();
    return deployed;
  }

  /** The alert goes out on microtasks only: the mail service is a fake. */
  async function polls(...failures: ReadonlyArray<Error | null>): Promise<void> {
    for (const failure of failures) {
      source.health?.(failure);
      await vi.advanceTimersByTimeAsync(5_000);
    }
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    engine = new EngineManager('test-server');
    alertOnSourceErrors(0); // Every event the engine raises.
  });

  afterEach(async () => {
    vi.useRealTimers();
    await engine.dispose();
  });

  it('raises one alert for an outage, however many polls it lasts, with the reason', async () => {
    await running();

    await polls(null, DOWN, DOWN, null, DOWN, DOWN);

    expect(alerts.sendMail).toHaveBeenCalledTimes(1);
    expect(alerts.sendMail.mock.calls[0]?.[2]).toBe('ALERT The source cannot receive, and goes on trying: connect ECONNREFUSED');
  });

  it('raises one for the next outage, once the source has worked for a minute', async () => {
    await running();

    await polls(DOWN, ...Array.from({ length: 13 }, () => null), DOWN);

    expect(alerts.sendMail).toHaveBeenCalledTimes(2);
  });

  it('raises one for the same outage after the channel was started again', async () => {
    const { runtime } = await running();
    await polls(DOWN);

    await runtime.stop();
    await runtime.start();
    await polls(DOWN, DOWN);

    expect(alerts.sendMail).toHaveBeenCalledTimes(2);
  });

  it('raises none once the channel is stopped, or while it stops', async () => {
    const { runtime } = await running();
    sourceMock.onStop.mockImplementation(async () => { source.health?.(DOWN); return OK_RESULT; });

    await runtime.stop();
    await polls(DOWN);

    expect(alerts.sendMail).not.toHaveBeenCalled();
  });
});

describe('EngineManager source failure', () => {
  it('stops the channel, records an ERROR event and raises a SOURCE_CONNECTOR alert', async () => {
    const engine = new EngineManager('test-server');
    await engine.deploy(BUNDLE);
    const deployed = engine.getRuntime(CHANNEL_ID)!;
    await deployed.runtime.start();
    expect(source.fatal).not.toBeNull();

    source.fatal?.(new Error('Kafka source stopped: the channel could not store the record at offset 7 after 5 attempts'));

    await vi.waitFor(() => { expect(deployed.runtime.getState()).toBe('STOPPED'); }, WAIT);
    expect(sourceMock.onStop).toHaveBeenCalledTimes(1);
    expect(events.emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: 'ERROR', name: 'CHANNEL_STOPPED', outcome: 'FAILURE', channelId: CHANNEL_ID,
      attributes: expect.objectContaining({ reason: 'SOURCE_FAILED', error: expect.stringContaining('offset 7') }),
    }));
    expect(events.emitToAll).toHaveBeenCalledWith(CHANNEL_ID, 'channel:state', { channelId: CHANNEL_ID, state: 'STOPPED' });
    await vi.waitFor(() => { expect(alerts.sendMail).toHaveBeenCalledTimes(1); }, WAIT);
    expect(alerts.sendMail.mock.calls[0]?.[2]).toContain('offset 7');
    await engine.dispose();
  });

  it('stops the source before the queued sends, which may take minutes (#413)', async () => {
    const order: string[] = [];
    const destination = Object.fromEntries(['onDeploy', 'onStart', 'onStop', 'onUndeploy'].map((name) => [name, vi.fn().mockResolvedValue(OK_RESULT)]));
    vi.mocked(createDestinationConnector).mockReturnValueOnce(destination as never);
    sourceMock.onStop.mockImplementation(async () => { order.push('source'); return OK_RESULT; });
    const engine = new EngineManager('test-server');
    await engine.deploy(QUEUED_BUNDLE);
    const { runtime, queueConsumers } = engine.getRuntime(CHANNEL_ID)!;
    await runtime.start();
    let sendEnds = (): void => undefined;
    vi.spyOn(queueConsumers[0]!, 'stop').mockImplementation(() => new Promise((resolve) => {
      order.push('queue');
      sendEnds = resolve;
    }));

    source.fatal?.(new Error('Kafka source stopped'));

    await vi.waitFor(() => { expect(order).toEqual(['source', 'queue']); }, WAIT);
    expect(destination['onStop']).not.toHaveBeenCalled();
    sendEnds();
    await vi.waitFor(() => { expect(runtime.getState()).toBe('STOPPED'); }, WAIT);
    expect(destination['onStop']).toHaveBeenCalledOnce();
    await engine.dispose();
  });

  it('ignores a report once the channel has been stopped: no event, no alert', async () => {
    const engine = new EngineManager('test-server');
    await engine.deploy(BUNDLE);
    const deployed = engine.getRuntime(CHANNEL_ID)!;
    await deployed.runtime.start();
    await deployed.runtime.stop();
    sourceMock.onStop.mockClear();

    source.fatal?.(new Error('AMQP source stopped'));
    await new Promise((resolve) => { setTimeout(resolve, 30); });

    expect(events.emitEvent).not.toHaveBeenCalled();
    expect(alerts.sendMail).not.toHaveBeenCalled();
    expect(sourceMock.onStop).not.toHaveBeenCalled();
    await engine.dispose();
  });

  it('ignores a report from the source of an earlier deployment of the channel', async () => {
    const engine = new EngineManager('test-server');
    await engine.deploy(BUNDLE);
    await engine.getRuntime(CHANNEL_ID)!.runtime.start();
    const oldHandler = source.fatal;
    await engine.undeploy(CHANNEL_ID);
    await engine.deploy(BUNDLE);
    const redeployed = engine.getRuntime(CHANNEL_ID)!;
    await redeployed.runtime.start();
    sourceMock.onStop.mockClear();

    oldHandler?.(new Error('Kafka source stopped (old deployment)'));
    await new Promise((resolve) => { setTimeout(resolve, 30); });

    expect(redeployed.runtime.getState()).toBe('STARTED');
    expect(events.emitEvent).not.toHaveBeenCalled();
    expect(alerts.sendMail).not.toHaveBeenCalled();
    expect(sourceMock.onStop).not.toHaveBeenCalled();
    await engine.dispose();
  });
});
