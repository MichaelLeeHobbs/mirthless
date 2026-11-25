// Which messages galvanigraph_messages_processed_total counts (#417).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bundleOf } from '../../../test/deployment-bundle.js';
import { messagesProcessedTotal } from '../../lib/metrics.js';
import type { DeployedChannel } from '../../engine.js';

vi.mock('@galvanigraph/connectors', () => {
  const done = { ok: true, value: undefined, error: null };
  return {
    createSourceConnector: vi.fn().mockReturnValue({
      setDispatcher: vi.fn(), onDeploy: vi.fn().mockResolvedValue(done), onStart: vi.fn().mockResolvedValue(done),
      onStop: vi.fn().mockResolvedValue(done), onHalt: vi.fn().mockResolvedValue(done), onUndeploy: vi.fn().mockResolvedValue(done),
    }),
    createDestinationConnector: vi.fn().mockReturnValue({
      onDeploy: vi.fn().mockResolvedValue(done), onStart: vi.fn().mockResolvedValue(done), onStop: vi.fn().mockResolvedValue(done),
      onHalt: vi.fn().mockResolvedValue(done), onUndeploy: vi.fn().mockResolvedValue(done), variablesUsed: () => [],
      send: vi.fn().mockResolvedValue({ ok: true, value: { status: 'SENT', content: 'ACK' }, error: null }),
    }),
    DISPATCH_STATUS: { PROCESSED: 'PROCESSED', FILTERED: 'FILTERED', ERROR: 'ERROR' },
  };
});

const ms = vi.hoisted(() => ({
  getLatestMessageId: vi.fn(), getUnprocessedMessages: vi.fn(), getConnectorMessages: vi.fn(), loadContent: vi.fn(),
  storeContent: vi.fn(), updateConnectorMessageStatus: vi.fn(), incrementStats: vi.fn(), markProcessed: vi.fn(),
  resetPending: vi.fn(), waitingByDestination: vi.fn(), initializeMessage: vi.fn(), finalizeMessage: vi.fn(),
  createConnectorMessage: vi.fn(), enqueue: vi.fn(), isFullyDelivered: vi.fn(),
}));
vi.mock('../message.service.js', () => ({ MessageService: ms }));

const EMPTY = vi.hoisted(() => ({ ok: true, value: [], error: null }));
vi.mock('../global-map.service.js', () => ({
  GlobalMapService: { list: vi.fn().mockResolvedValue(EMPTY), persist: vi.fn(), persistRemoval: vi.fn(), onChange: vi.fn() },
}));
vi.mock('../config-map.service.js', () => ({ ConfigMapService: { list: vi.fn().mockResolvedValue(EMPTY) } }));
vi.mock('../alert.service.js', () => ({
  AlertService: { listEnabled: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }), onChange: vi.fn() },
}));
vi.mock('../email.service.js', () => ({ EmailService: { sendMail: vi.fn() } }));
vi.mock('../../lib/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../config/index.js', () => ({ config: { LOG_LEVEL: 'info', NODE_ENV: 'test' } }));

const { EngineManager } = await import('../../engine.js');

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const ok = <T>(value: T): { ok: true; value: T; error: null } => ({ ok: true, value, error: null });

let engine: InstanceType<typeof EngineManager>;

async function counted(): Promise<number> {
  return (await messagesProcessedTotal.get()).values[0]?.value ?? 0;
}

type Processed = Awaited<ReturnType<DeployedChannel['processMessage']>>;

async function processOne(settings: Record<string, unknown>): Promise<Processed> {
  await engine.deploy(bundleOf({
    id: CHANNEL_ID, name: 'Labs', enabled: true, sourceConnectorType: 'TCP_MLLP', sourceConnectorProperties: { port: 6661 },
    inboundDataType: 'RAW', outboundDataType: 'RAW', messageStorageMode: 'DEVELOPMENT', encryptData: false, metadataColumns: [],
    destinations: [], scripts: [], filters: [], transformers: [], ...settings,
  } as never));
  return engine.getRuntime(CHANNEL_ID)!.processMessage('x');
}

beforeEach(() => {
  vi.clearAllMocks();
  engine = new EngineManager('test-server');
  for (const fn of Object.values(ms)) fn.mockResolvedValue(ok(undefined));
  ms.getLatestMessageId.mockResolvedValue(ok(0));
  ms.isFullyDelivered.mockResolvedValue(ok(false));
  ms.waitingByDestination.mockResolvedValue(EMPTY);
  ms.initializeMessage.mockResolvedValue(ok({ messageId: 1, correlationId: '00000000-0000-0000-0000-000000000099' }));
});

afterEach(async () => {
  await engine.dispose();
});

describe('galvanigraph_messages_processed_total', () => {
  const destination = (queueMode: string): Record<string, unknown> =>
    ({ id: 'd1', metaDataId: 1, name: 'Lab', enabled: true, connectorType: 'HTTP', properties: {}, queueMode });
  const filtersAll = { connectorId: null, rules: [{ sequenceNumber: 0, enabled: true, operator: 'AND', type: 'JAVASCRIPT', script: 'return false;' }] };

  it.each([
    ['delivered', { destinations: [destination('NEVER')] }, { status: 'PROCESSED' }],
    ['put on a queue', { destinations: [destination('ALWAYS')] }, { status: 'PROCESSED', queued: true }],
    ['filtered', { filters: [filtersAll] }, { status: 'FILTERED' }],
    ['recorded with an error', { scripts: [{ scriptType: 'PREPROCESSOR', script: 'throw new Error("boom");' }] }, { status: 'ERROR' }],
  ])('counts a message that was %s, once', async (_outcome, settings, outcome) => {
    const before = await counted();

    expect((await processOne(settings)).value).toMatchObject(outcome);

    expect(await counted()).toBe(before + 1);
  });

  it('does not count a message the store refused on receipt', async () => {
    ms.initializeMessage.mockResolvedValue({ ok: false, value: null, error: new Error('store down') });
    const before = await counted();

    expect((await processOne({})).ok).toBe(false);

    expect(await counted()).toBe(before);
  });
});
