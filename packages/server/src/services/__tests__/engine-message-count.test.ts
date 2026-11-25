// Which messages galvanigraph_messages_processed_total counts (#417).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bundleOf } from '../../../test/deployment-bundle.js';
import { messagesProcessedTotal } from '../../lib/metrics.js';

vi.mock('@galvanigraph/connectors', () => {
  const done = { ok: true, value: undefined, error: null };
  return {
    createSourceConnector: vi.fn().mockReturnValue({
      setDispatcher: vi.fn(), onDeploy: vi.fn().mockResolvedValue(done), onStart: vi.fn().mockResolvedValue(done),
      onStop: vi.fn().mockResolvedValue(done), onHalt: vi.fn().mockResolvedValue(done), onUndeploy: vi.fn().mockResolvedValue(done),
    }),
    createDestinationConnector: vi.fn(),
    DISPATCH_STATUS: { PROCESSED: 'PROCESSED', FILTERED: 'FILTERED', ERROR: 'ERROR' },
  };
});

const ms = vi.hoisted(() => ({
  getLatestMessageId: vi.fn(), getUnprocessedMessages: vi.fn(), getConnectorMessages: vi.fn(), loadContent: vi.fn(),
  storeContent: vi.fn(), updateConnectorMessageStatus: vi.fn(), incrementStats: vi.fn(), markProcessed: vi.fn(),
  resetPending: vi.fn(), waitingByDestination: vi.fn(), initializeMessage: vi.fn(), finalizeMessage: vi.fn(),
  createConnectorMessage: vi.fn(),
}));
vi.mock('../message.service.js', () => ({ MessageService: ms }));

const EMPTY = vi.hoisted(() => ({ ok: true, value: [], error: null }));
vi.mock('../global-map.service.js', () => ({
  GlobalMapService: { list: vi.fn().mockResolvedValue(EMPTY), persist: vi.fn(), persistRemoval: vi.fn(), onChange: vi.fn() },
}));
vi.mock('../config-map.service.js', () => ({ ConfigMapService: { list: vi.fn().mockResolvedValue(EMPTY) } }));
vi.mock('../alert.service.js', () => ({
  AlertService: {
    list: vi.fn().mockResolvedValue({ ok: true, value: { data: [], pagination: { page: 1, pageSize: 1000, total: 0, totalPages: 0 } }, error: null }),
    getByIds: vi.fn().mockResolvedValue(EMPTY),
  },
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

async function process(scripts: Record<string, unknown>): Promise<void> {
  await engine.deploy(bundleOf({
    id: CHANNEL_ID, name: 'Labs', enabled: true, sourceConnectorType: 'TCP_MLLP', sourceConnectorProperties: { port: 6661 },
    inboundDataType: 'RAW', outboundDataType: 'RAW', messageStorageMode: 'DEVELOPMENT', encryptData: false, metadataColumns: [],
    destinations: [], scripts: [], filters: [], transformers: [], ...scripts,
  } as never));
  await engine.getRuntime(CHANNEL_ID)!.processMessage('x');
}

beforeEach(() => {
  vi.clearAllMocks();
  engine = new EngineManager('test-server');
  for (const fn of Object.values(ms)) fn.mockResolvedValue(ok(undefined));
  ms.getLatestMessageId.mockResolvedValue(ok(0));
  ms.waitingByDestination.mockResolvedValue(EMPTY);
  ms.initializeMessage.mockResolvedValue(ok({ messageId: 1, correlationId: '00000000-0000-0000-0000-000000000099' }));
});

afterEach(async () => {
  await engine.dispose();
});

describe('galvanigraph_messages_processed_total', () => {
  it.each([
    ['delivered', {}],
    ['recorded with an error', { scripts: [{ scriptType: 'PREPROCESSOR', script: 'throw new Error("boom");' }] }],
  ])('counts a message that was %s, once', async (_outcome, scripts) => {
    const before = await counted();

    await process(scripts);

    expect(await counted()).toBe(before + 1);
  });

  it('does not count a message that was not recorded', async () => {
    ms.initializeMessage.mockResolvedValue({ ok: false, value: null, error: new Error('store down') });
    const before = await counted();

    await process({});

    expect(await counted()).toBe(before);
  });
});
