// What a source that splits HL7 batches gets back for one it dispatched.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bundleOf } from '../../../test/deployment-bundle.js';

type Dispatch = (raw: { readonly content: string; readonly sourceMap: Record<string, unknown> }) => Promise<{ ok: boolean; error: Error | null }>;

const source = vi.hoisted(() => ({ setDispatcher: vi.fn() }));

vi.mock('@galvanigraph/connectors', () => {
  const lifecycle = {
    onDeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onStart: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onStop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onHalt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    onUndeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  };
  return {
    createSourceConnector: vi.fn().mockReturnValue({ ...lifecycle, setScriptRunner: vi.fn(), setDispatcher: source.setDispatcher }),
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
  AlertService: { list: vi.fn().mockResolvedValue({ ok: true, value: { data: [], pagination: { page: 1, pageSize: 1000, total: 0, totalPages: 0 } }, error: null }) },
}));

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('../../lib/logger.js', () => ({ default: log }));
vi.mock('../../config/index.js', () => ({ config: { LOG_LEVEL: 'info', NODE_ENV: 'test' } }));

const { EngineManager } = await import('../../engine.js');

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const part = (id: number, text = 'x'): string => `MSH|^~\\&|LAB|F|HUB|V|20261125||ORU^R01|B-${String(id)}|P|2.5\rNTE|1||${text}`;
const ok = <T>(value: T): { ok: true; value: T; error: null } => ({ ok: true, value, error: null });

let engine: InstanceType<typeof EngineManager>;
/** The control ids of the messages the store was asked to record. */
let recorded: string[];

async function deploy(channel: Record<string, unknown> = {}): Promise<Dispatch> {
  await engine.deploy(bundleOf({
    id: CHANNEL_ID, name: 'Labs', enabled: true, sourceConnectorType: 'FILE', sourceConnectorProperties: { processBatch: true },
    inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', messageStorageMode: 'DEVELOPMENT', encryptData: false, metadataColumns: [],
    destinations: [], scripts: [], filters: [], transformers: [], ...channel,
  } as never));
  await engine.getRuntime(CHANNEL_ID)!.runtime.start();
  return source.setDispatcher.mock.lastCall![0] as Dispatch;
}

function failingAt(id: number): void {
  ms.initializeMessage.mockImplementation(async (...args: unknown[]) => {
    const raw = (args[3] as Array<{ content: string }>)[0]!.content;
    const controlId = /\|B-(\d+)\|/.exec(raw)![1]!;
    if (controlId === String(id)) return { ok: false, value: null, error: new Error('store down') };
    recorded.push(controlId);
    return ok({ messageId: Number(controlId), correlationId: '00000000-0000-0000-0000-000000000099' });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded = [];
  engine = new EngineManager('test-server');
  for (const fn of Object.values(ms)) fn.mockResolvedValue(ok(undefined));
  ms.getLatestMessageId.mockResolvedValue(ok(0));
  ms.getUnprocessedMessages.mockResolvedValue(EMPTY);
  ms.waitingByDestination.mockResolvedValue(EMPTY);
});

afterEach(async () => {
  await engine.dispose();
});

describe('a batch dispatched to a channel (#415)', () => {
  it('is not taken when the store fails part-way, after a message recorded with an error, and logs which one', async () => {
    const dispatch = await deploy({ scripts: [{ scriptType: 'PREPROCESSOR', script: 'if (String(msg).includes("B-2")) throw new Error("boom");' }] });
    failingAt(3);
    const batch = ['FHS|^~\\&|LAB', part(1), part(2), part(3), part(4)].join('\r');

    const result = await dispatch({ content: batch, sourceMap: {} });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('Message 3 of 4 in the batch was not recorded');
    expect(recorded).toEqual(['1', '2']);
    expect(ms.updateConnectorMessageStatus.mock.calls.map((call) => call.slice(1, 4))).toContainEqual([2, 0, 'ERROR']);
    const lines = log.error.mock.calls.filter(([, text]) => String(text).includes('batch'));
    expect(lines).toHaveLength(1);
    expect(lines[0]![0]).toMatchObject({ channelId: CHANNEL_ID, errMsg: expect.stringContaining('Message 3 of 4') as string });
  });

  it('runs the rest for a JavaScript source, which never offers a batch again', async () => {
    const dispatch = await deploy({ sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { processBatch: true, script: 'return null;' } });
    failingAt(2);

    const result = await dispatch({ content: [part(1), part(2), part(3)].join('\r'), sourceMap: {} });

    expect(result.ok).toBe(false);
    expect(recorded).toEqual(['1', '3']);
  });

  it('records nothing of a batch with U+0000 in plain text, however often it is offered', async () => {
    const dispatch = await deploy();
    failingAt(-1);

    for (let offer = 0; offer < 3; offer++) {
      const result = await dispatch({ content: [part(1), part(2, 'x\u0000y')].join('\r'), sourceMap: {} });
      expect(result.error?.message).toContain('U+0000');
    }

    expect(recorded).toEqual([]);
  });
});
