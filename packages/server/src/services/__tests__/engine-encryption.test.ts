import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import { bundleOf } from '../../../test/deployment-bundle.js';

const cfg: { CONTENT_ENCRYPTION_KEY: string | undefined } = {
  CONTENT_ENCRYPTION_KEY: 'a'.repeat(64),
};
vi.mock('../../config/index.js', () => ({ config: cfg }));

vi.mock('@galvanigraph/engine', () => ({
  ChannelRuntime: vi.fn(),
  VmSandboxExecutor: vi.fn().mockImplementation(function () { return { execute: vi.fn(), dispose: vi.fn() }; }),
  MessageProcessor: vi.fn(),
  DEFAULT_EXECUTION_OPTIONS: {},
  GlobalChannelMap: vi.fn(),
  GlobalMapProxy: vi.fn().mockImplementation(function () { return { load: vi.fn(), start: vi.fn(), toRecord: vi.fn().mockReturnValue({}), applyChanges: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn(), flush: vi.fn().mockResolvedValue(undefined), dispose: vi.fn().mockResolvedValue(undefined) }; }),
  compileScript: vi.fn(),
  compileFilterRulesToScript: vi.fn(),
  compileTransformerStepsToScript: vi.fn(),
  prependTemplates: vi.fn(),
  AlertManager: vi.fn(),
  QueueConsumer: vi.fn(),
  RecoveryManager: vi.fn().mockImplementation(function () {
    return {
      recover: vi.fn().mockResolvedValue({ ok: true, value: { recovered: 0, errors: 0, skipped: 0 }, error: null }),
    };
  }),
}));

vi.mock('@galvanigraph/connectors', () => ({
  createSourceConnector: vi.fn(),
  createDestinationConnector: vi.fn(),
  JavaScriptReceiver: vi.fn(),
  JavaScriptDispatcher: vi.fn(),
  DISPATCH_STATUS: { PROCESSED: 'PROCESSED', FILTERED: 'FILTERED', ERROR: 'ERROR' },
}));

const mockStoreContent = vi.fn();
const mockInitializeMessage = vi.fn();
const mockWarn = vi.fn();

vi.mock('../message.service.js', () => ({
  MessageService: {
    createMessage: vi.fn(),
    createConnectorMessage: vi.fn(),
    updateConnectorMessageStatus: vi.fn(),
    storeContent: mockStoreContent,
    markProcessed: vi.fn(),
    enqueue: vi.fn(),
    loadContent: vi.fn(),
    incrementStats: vi.fn(),
    dequeue: vi.fn(),
    release: vi.fn(),
    deleteContent: vi.fn(),
    deleteAttachments: vi.fn(),
    resetPending: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    waitingByDestination: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
    getUnprocessedMessages: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
    getLatestMessageId: vi.fn().mockResolvedValue({ ok: true, value: 0, error: null }),
    getConnectorMessages: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
    initializeMessage: mockInitializeMessage,
    finalizeMessage: vi.fn(),
  },
}));

vi.mock('../global-map.service.js', () => ({ GlobalMapService: { list: vi.fn(), upsert: vi.fn(), persist: vi.fn(), persistRemoval: vi.fn(), onChange: vi.fn() } }));
vi.mock('../config-map.service.js', () => ({ ConfigMapService: { list: vi.fn() } }));
vi.mock('../alert.service.js', () => ({ AlertService: { list: vi.fn(), getByIds: vi.fn() } }));
vi.mock('../email.service.js', () => ({ EmailService: { sendMail: vi.fn() } }));
vi.mock('../../lib/db.js', () => ({ db: { select: vi.fn(), execute: vi.fn() }, default: {} }));
vi.mock('../../lib/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: mockWarn, debug: vi.fn(), level: 'info' } }));
vi.mock('../../lib/socket.js', () => ({ emitToRoom: vi.fn(), emitToRoomCoalesced: vi.fn(), emitToAll: vi.fn() }));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  asc: vi.fn(),
  and: vi.fn(),
  sql: Object.assign(() => ({}), { raw: () => ({}) }),
}));

// Import after mocks. content-crypto is NOT mocked — it uses the mocked config.
const { createMessageStoreAdapter, EngineManager } = await import('../../engine.js');
const { decryptContent, isEncryptedEnvelope } = await import('../../lib/content-crypto.js');

function ok<T>(value: T): { ok: true; value: T; error: null } {
  return { ok: true, value, error: null };
}

const PHI = 'MSH|^~\\&|LAB|HOSP|patient Jane Doe SSN 123-45-6789';

beforeEach(() => {
  vi.clearAllMocks();
  cfg.CONTENT_ENCRYPTION_KEY = 'a'.repeat(64);
  mockStoreContent.mockResolvedValue(ok(undefined));
  mockInitializeMessage.mockResolvedValue(ok({ messageId: 1, correlationId: 'c1' }));
});

describe('message store adapter — encryptData enabled', () => {
  it('encrypts content before persisting (stored bytes are NOT plaintext) and sets is_encrypted', async () => {
    const store = createMessageStoreAdapter({
      messageStorageMode: 'DEVELOPMENT',
      removeContentOnCompletion: false,
      removeAttachmentsOnCompletion: false,
      encryptData: true,
    });

    const result = await store.storeContent('ch1', 1, 0, 1, PHI, 'HL7V2');
    expect(result.ok).toBe(true);
    expect(mockStoreContent).toHaveBeenCalledTimes(1);

    const args = mockStoreContent.mock.calls[0]!;
    const storedContent = args[4] as string;
    const encryptedFlag = args[6] as boolean;

    expect(isEncryptedEnvelope(storedContent)).toBe(true);
    expect(storedContent).not.toContain('Jane Doe');
    expect(storedContent).not.toBe(PHI);
    expect(encryptedFlag).toBe(true);
  });

  it('round-trips: the stored ciphertext decrypts back to the original', async () => {
    const store = createMessageStoreAdapter({
      messageStorageMode: 'DEVELOPMENT',
      removeContentOnCompletion: false,
      removeAttachmentsOnCompletion: false,
      encryptData: true,
    });

    await store.storeContent('ch1', 1, 0, 1, PHI, 'HL7V2');
    const storedContent = mockStoreContent.mock.calls[0]![4] as string;

    const dec = decryptContent(storedContent);
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(dec.value).toBe(PHI);
  });

  it('encrypts each content row in initializeMessage and flags them encrypted', async () => {
    const store = createMessageStoreAdapter({
      messageStorageMode: 'DEVELOPMENT',
      removeContentOnCompletion: false,
      removeAttachmentsOnCompletion: false,
      encryptData: true,
    });

    await store.initializeMessage!('ch1', 'srv', 'source', [
      { metaDataId: 0, contentType: 1, content: PHI, dataType: 'HL7V2' },
    ], undefined);

    expect(mockInitializeMessage).toHaveBeenCalledTimes(1);
    const call = mockInitializeMessage.mock.calls[0]!;
    const rows = call[3] as { content: string }[];
    const encryptedFlag = call[5] as boolean;
    expect(encryptedFlag).toBe(true);
    expect(isEncryptedEnvelope(rows[0]!.content)).toBe(true);
    expect(rows[0]!.content).not.toContain('Jane Doe');
    const dec = decryptContent(rows[0]!.content);
    expect(dec.ok && dec.value === PHI).toBe(true);
  });

  it('fails loudly (does not store plaintext) when encryption fails', async () => {
    cfg.CONTENT_ENCRYPTION_KEY = undefined; // no key → encrypt() fails
    const store = createMessageStoreAdapter({
      messageStorageMode: 'DEVELOPMENT',
      removeContentOnCompletion: false,
      removeAttachmentsOnCompletion: false,
      encryptData: true,
    });

    const result = await store.storeContent('ch1', 1, 0, 1, PHI, 'HL7V2');
    expect(result.ok).toBe(false);
    expect(mockStoreContent).not.toHaveBeenCalled();
  });
});

describe('message store adapter — encryptData disabled', () => {
  it('stores plaintext with is_encrypted false', async () => {
    const store = createMessageStoreAdapter({
      messageStorageMode: 'DEVELOPMENT',
      removeContentOnCompletion: false,
      removeAttachmentsOnCompletion: false,
      encryptData: false,
    });

    await store.storeContent('ch1', 1, 0, 1, PHI, 'HL7V2');
    const args = mockStoreContent.mock.calls[0]!;
    expect(args[4]).toBe(PHI);
    expect(args[6]).toBe(false);
  });
});

describe('message store adapter — text with U+0000, which Postgres refuses (#404)', () => {
  const NUL = String.fromCharCode(0);
  const ANSWER = `MSA|AA|MRN-8675309${NUL}${NUL}end`;
  const adapter = (encryptData: boolean): ReturnType<typeof createMessageStoreAdapter> => createMessageStoreAdapter({
    messageStorageMode: 'DEVELOPMENT', removeContentOnCompletion: false, removeAttachmentsOnCompletion: false, encryptData,
  });
  const storedText = (): string => mockStoreContent.mock.calls[0]![4] as string;

  it.each([
    ['a response', CONTENT_TYPE.RESPONSE],
    ['a transformed response', CONTENT_TYPE.RESPONSE_TRANSFORMED],
    ['why a destination failed', CONTENT_TYPE.ERROR],
    ['why a script failed', CONTENT_TYPE.PROCESSING_ERROR],
  ])('is kept for %s with each U+0000 as U+2400, and the log says so without the text', async (_what, contentType) => {
    const stored = await adapter(false).storeContent('ch1', 7, 2, contentType, ANSWER, 'TEXT');

    expect(stored.ok).toBe(true);
    expect(storedText()).toBe('MSA|AA|MRN-8675309\u2400\u2400end');
    expect(mockWarn).toHaveBeenCalledExactlyOnceWith({ channelId: 'ch1', messageId: 7, metaDataId: 2, contentType }, expect.stringContaining('U+0000'));
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('8675309');
  });

  it.each([
    ['TRANSFORMED', CONTENT_TYPE.TRANSFORMED],
    ['SENT', CONTENT_TYPE.SENT],
  ])('is not changed in %s, which can be sent or run again', async (_what, contentType) => {
    await adapter(false).storeContent('ch1', 7, 2, contentType, ANSWER, 'TEXT');

    expect(storedText()).toBe(ANSWER);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('is not changed in a message as it was received', async () => {
    const rows = [{ metaDataId: 0, contentType: CONTENT_TYPE.RAW, content: ANSWER, dataType: 'RAW' }];
    await adapter(false).initializeMessage!('ch1', 'srv', 'Source', rows);

    expect(mockInitializeMessage.mock.calls[0]![3]).toEqual(rows);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('is kept exactly when the channel encrypts its content', async () => {
    await adapter(true).storeContent('ch1', 7, 2, CONTENT_TYPE.RESPONSE, ANSWER, 'TEXT');

    expect(decryptContent(storedText())).toMatchObject({ ok: true, value: ANSWER });
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('leaves other text as it is, U+2400 included, without a log line', async () => {
    await adapter(false).storeContent('ch1', 7, 2, CONTENT_TYPE.RESPONSE, 'MSA|AA|1\r\u2400', 'TEXT');

    expect(storedText()).toBe('MSA|AA|1\r\u2400');
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('is not kept at all when the storage mode keeps no response', async () => {
    const store = createMessageStoreAdapter({ messageStorageMode: 'RAW', removeContentOnCompletion: false, removeAttachmentsOnCompletion: false, encryptData: false });
    await store.storeContent('ch1', 7, 2, CONTENT_TYPE.RESPONSE, ANSWER, 'TEXT');

    expect(mockStoreContent).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });
});

describe('EngineManager.deploy — encryptData key guard', () => {
  function makeChannel(encryptData: boolean): Record<string, unknown> {
    return {
      id: 'ch-guard', name: 'Guarded', encryptData,
      messageStorageMode: 'DEVELOPMENT',
      removeContentOnCompletion: false, removeAttachmentsOnCompletion: false,
      sourceConnectorType: 'TCP_MLLP', sourceConnectorProperties: {},
      inboundDataType: 'HL7V2', destinations: [], metadataColumns: [], scripts: [], filters: [], transformers: [],
    };
  }

  it('refuses to deploy an encryptData channel when no key is configured', async () => {
    cfg.CONTENT_ENCRYPTION_KEY = undefined;
    const engine = new EngineManager();
    await expect(engine.deploy(bundleOf(makeChannel(true) as never))).rejects.toThrow(/CONTENT_ENCRYPTION_KEY/);
  });
});
