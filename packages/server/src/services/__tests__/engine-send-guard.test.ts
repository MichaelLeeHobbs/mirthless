// A destination connector that throws instead of answering (#419).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bundleOf } from '../../../test/deployment-bundle.js';

const OK = { ok: true, value: undefined, error: null };
const ok = <T>(value: T): { ok: true; value: T; error: null } => ({ ok: true, value, error: null });

const send = vi.hoisted(() => ({ broken: vi.fn(), healthy: vi.fn() }));
vi.mock('@galvanigraph/connectors', () => {
  const lifecycle = (): Record<string, unknown> => Object.fromEntries(
    ['onDeploy', 'onStart', 'onStop', 'onHalt', 'onUndeploy'].map((name) => [name, vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null })]),
  );
  return {
    createSourceConnector: () => ({ ...lifecycle(), setDispatcher: vi.fn() }),
    createDestinationConnector: (_type: string, properties: { readonly broken?: boolean }) => ({
      ...lifecycle(), variablesUsed: () => [], send: properties.broken === true ? send.broken : send.healthy,
    }),
    JavaScriptReceiver: vi.fn(),
    JavaScriptDispatcher: vi.fn(),
    DISPATCH_STATUS: { PROCESSED: 'PROCESSED', FILTERED: 'FILTERED', ERROR: 'ERROR' },
  };
});

const ms = vi.hoisted(() => Object.fromEntries([
  'getLatestMessageId', 'getUnprocessedMessages', 'getConnectorMessages', 'loadContent', 'storeContent', 'updateConnectorMessageStatus',
  'incrementStats', 'markProcessed', 'resetPending', 'waitingByDestination', 'initializeMessage', 'finalizeMessage', 'createConnectorMessage',
  'enqueue', 'removeContent', 'isFullyDelivered', 'dequeue', 'release',
].map((name) => [name, vi.fn()])));
vi.mock('../message.service.js', () => ({ MessageService: ms }));

const EMPTY = { ok: true, value: [], error: null };
vi.mock('../global-map.service.js', () => ({
  GlobalMapService: { list: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }), persist: vi.fn(), persistRemoval: vi.fn(), onChange: vi.fn() },
}));
vi.mock('../config-map.service.js', () => ({ ConfigMapService: { list: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }) } }));
vi.mock('../alert.service.js', () => ({
  AlertService: {
    list: vi.fn().mockResolvedValue({ ok: true, value: { data: [], pagination: { page: 1, pageSize: 1000, total: 0, totalPages: 0 } }, error: null }),
    getByIds: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
  },
}));
vi.mock('../email.service.js', () => ({ EmailService: { sendMail: vi.fn() } }));
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn(), emitAuditEvent: vi.fn() }));
vi.mock('../../lib/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../config/index.js', () => ({ config: { LOG_LEVEL: 'info', NODE_ENV: 'test' } }));

// Must import after mocks
const { EngineManager } = await import('../../engine.js');

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const BROKEN = 1;
const HEALTHY = 2;
const ERROR = 11;
const PROCESSING_ERROR = 13;

function destination(metaDataId: number, queueMode: string): Record<string, unknown> {
  return {
    id: `d${String(metaDataId)}`, metaDataId, name: metaDataId === BROKEN ? 'Broken' : 'Healthy', enabled: true, connectorType: 'HTTP',
    properties: { broken: metaDataId === BROKEN }, queueMode, retryCount: 0, retryIntervalMs: 60_000, rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
  };
}

async function sendOne(brokenQueueMode = 'NEVER'): Promise<unknown> {
  const engine = new EngineManager('test-server');
  await engine.deploy(bundleOf({
    id: CHANNEL_ID, name: 'Labs', enabled: true, sourceConnectorType: 'TCP_MLLP', sourceConnectorProperties: { port: 6661 },
    inboundDataType: 'RAW', outboundDataType: 'RAW', messageStorageMode: 'DEVELOPMENT', scriptTimeoutSeconds: 30,
    metadataColumns: [], scripts: [], filters: [], transformers: [],
    destinations: [destination(BROKEN, brokenQueueMode), destination(HEALTHY, 'NEVER')],
  } as never));
  await engine.getRuntime(CHANNEL_ID)!.runtime.start();
  const outcome = await engine.sendMessage(CHANNEL_ID, 'x');
  await engine.dispose();
  return outcome;
}

const statusesOf = (metaDataId: number): unknown[] => ms['updateConnectorMessageStatus']!.mock.calls.filter((c) => c[2] === metaDataId).map((c) => c[3] as unknown);
const errorOf = (metaDataId: number, contentType: number): unknown => ms['storeContent']!.mock.calls.find((c) => c[2] === metaDataId && c[3] === contentType)?.[4];

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(ms)) fn.mockResolvedValue(OK);
  for (const name of ['getUnprocessedMessages', 'getConnectorMessages', 'waitingByDestination', 'dequeue']) ms[name]!.mockResolvedValue(EMPTY);
  ms['getLatestMessageId']!.mockResolvedValue(ok(0));
  ms['loadContent']!.mockResolvedValue(ok(null));
  ms['isFullyDelivered']!.mockResolvedValue(ok(false));
  ms['initializeMessage']!.mockResolvedValue(ok({ messageId: 7, correlationId: '00000000-0000-0000-0000-000000000099' }));
  send.healthy.mockResolvedValue(ok({ status: 'SENT', content: 'ACK' }));
});

describe.each([
  ['throws', (): never => { throw new Error('cannot read properties of null'); }],
  ['rejects', (): Promise<never> => Promise.reject(new Error('cannot read properties of null'))],
])('a destination whose send %s', (_how, failing) => {
  beforeEach(() => { send.broken.mockImplementation(failing); });

  it('is the one recorded as failed, with the reason, and the message is not failed before it', async () => {
    await sendOne();

    expect(statusesOf(BROKEN)).toEqual(['ERROR']);
    expect(errorOf(BROKEN, ERROR)).toContain('cannot read properties of null');
    expect(errorOf(0, PROCESSING_ERROR)).toBeUndefined();
  });

  it('leaves the other destination delivered', async () => {
    await sendOne();

    expect(send.healthy).toHaveBeenCalledOnce();
    expect(statusesOf(HEALTHY)).toEqual(['SENT']);
  });

  it('is queued for another try when it queues on failure', async () => {
    await sendOne('ON_FAILURE');

    expect(ms['enqueue']).toHaveBeenCalledWith(CHANNEL_ID, 7, BROKEN);
    expect(errorOf(0, PROCESSING_ERROR)).toBeUndefined();
  });
});
