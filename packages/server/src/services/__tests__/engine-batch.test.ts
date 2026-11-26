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
const alerts = vi.hoisted(() => ({ listEnabled: vi.fn(), onChange: vi.fn(), sendMail: vi.fn() }));
vi.mock('../alert.service.js', () => ({ AlertService: { listEnabled: alerts.listEnabled, onChange: alerts.onChange } }));
vi.mock('../email.service.js', () => ({ EmailService: { sendMail: alerts.sendMail } }));

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

/** Halts the channel while the store records that message. */
function haltingAt(id: number): void {
  const record = ms.initializeMessage.getMockImplementation()!;
  ms.initializeMessage.mockImplementation(async (...args: unknown[]) => {
    const raw = (args[3] as Array<{ content: string }>)[0]!.content;
    if (raw.includes(`|B-${String(id)}|`)) await engine.getRuntime(CHANNEL_ID)!.runtime.halt();
    return record(...args);
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
  const alert = {
    id: 'a1', name: 'Errors', enabled: true, channelIds: [CHANNEL_ID],
    trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null },
    actions: [{ id: 'act1', actionType: 'EMAIL', recipients: ['oncall@example.org'], properties: null }],
    subjectTemplate: null, bodyTemplate: 'ALERT ${errorMessage}', reAlertIntervalMs: null, maxAlerts: null,
  };
  alerts.listEnabled.mockResolvedValue(ok([alert]));
  alerts.sendMail.mockResolvedValue(ok(undefined));
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
    expect(result.error?.message).toContain('Not recorded of the 4 messages in the batch: 3.');
    expect(recorded).toEqual(['1', '2']);
    expect(ms.updateConnectorMessageStatus.mock.calls.map((call) => call.slice(1, 4))).toContainEqual([2, 0, 'ERROR']);
    const lines = log.error.mock.calls.filter(([, text]) => String(text).includes('batch'));
    expect(lines).toHaveLength(1);
    expect(lines[0]![0]).toMatchObject({ channelId: CHANNEL_ID, errMsg: expect.stringContaining('batch: 3.') as string });
  });

  it('runs the rest for a JavaScript source, which never offers a batch again', async () => {
    const dispatch = await deploy({ sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { processBatch: true, script: 'return null;' } });
    failingAt(2);

    const result = await dispatch({ content: [part(1), part(2), part(3)].join('\r'), sourceMap: {} });

    expect(result.ok).toBe(false);
    expect(recorded).toEqual(['1', '3']);
  });

  it('runs no message after a halt in the middle of the batch, and is not taken (#484, #441)', async () => {
    const dispatch = await deploy();
    failingAt(-1);
    haltingAt(2);

    const result = await dispatch({ content: [part(1), part(2), part(3)].join('\r'), sourceMap: {} });

    expect(result.error?.message).toContain('halted at message 2 of the 3');
    expect(recorded).toEqual(['1', '2']);
    // The halt was someone's choice, not a failure: a warning, not the error line that comes with the alert.
    expect(log.warn.mock.calls.map(([, text]) => text)).toContain('HL7 batch ended by a halt; it is not taken');
    expect(log.error.mock.calls.filter(([, text]) => String(text).includes('batch'))).toEqual([]);
  });

  it('ends every message after a halt for a JavaScript source, not only the one in flight', async () => {
    const dispatch = await deploy({
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { processBatch: true, script: 'return null;' },
      scripts: [{ scriptType: 'PREPROCESSOR', script: 'return rawData;' }],
    });
    failingAt(-1);
    haltingAt(1);

    await dispatch({ content: [part(1), part(2), part(3)].join('\r'), sourceMap: {} });

    expect(recorded).toEqual(['1', '2', '3']);
    const ended = ms.updateConnectorMessageStatus.mock.calls.filter((call) => call[2] === 0 && call[3] === 'ERROR').map((call) => call[1]);
    expect(ended).toEqual([1, 2, 3]);
  });

  it('records nothing of a batch with U+0000 in plain text, and raises an alert', async () => {
    const dispatch = await deploy();
    failingAt(-1);

    const result = await dispatch({ content: [part(1), part(2, 'x\u0000y')].join('\r'), sourceMap: {} });

    expect(result.error?.message).toContain('U+0000');
    expect(recorded).toEqual([]);
    await vi.waitFor(() => { expect(JSON.stringify(alerts.sendMail.mock.calls)).toContain('HL7 batch not recorded whole'); }, { timeout: 10_000 });
  });
});
