// ===========================================
// Engine Content-Encryption Tests
// ===========================================
// Verifies the message store adapter encrypts content at rest when a channel
// has encryptData enabled (round-trip, is_encrypted flag, stored bytes are NOT
// plaintext, mixed rows) and that EngineManager.deploy refuses to deploy an
// encryptData channel with no key configured.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Config mock (drives content-crypto key) -----

const cfg: { CONTENT_ENCRYPTION_KEY: string | undefined } = {
  CONTENT_ENCRYPTION_KEY: 'a'.repeat(64),
};
vi.mock('../../config/index.js', () => ({ config: cfg }));

// ----- Engine / connector mocks -----

vi.mock('@mirthless/engine', () => ({
  ChannelRuntime: vi.fn(),
  VmSandboxExecutor: vi.fn().mockImplementation(() => ({ execute: vi.fn(), dispose: vi.fn() })),
  MessageProcessor: vi.fn(),
  DEFAULT_EXECUTION_OPTIONS: {},
  GlobalChannelMap: vi.fn(),
  GlobalMapProxy: vi.fn().mockImplementation(() => ({ load: vi.fn(), start: vi.fn(), toRecord: vi.fn().mockReturnValue({}), applyUpdates: vi.fn(), flush: vi.fn().mockResolvedValue(undefined), dispose: vi.fn().mockResolvedValue(undefined) })),
  compileScript: vi.fn(),
  compileFilterRulesToScript: vi.fn(),
  compileTransformerStepsToScript: vi.fn(),
  prependTemplates: vi.fn(),
  AlertManager: vi.fn(),
  QueueConsumer: vi.fn(),
  RecoveryManager: vi.fn().mockImplementation(() => ({
    recover: vi.fn().mockResolvedValue({ ok: true, value: { recovered: 0, errors: 0, skipped: 0 }, error: null }),
  })),
}));

vi.mock('@mirthless/connectors', () => ({
  createSourceConnector: vi.fn(),
  createDestinationConnector: vi.fn(),
  JavaScriptReceiver: vi.fn(),
  JavaScriptDispatcher: vi.fn(),
  DISPATCH_STATUS: { PROCESSED: 'PROCESSED', FILTERED: 'FILTERED', ERROR: 'ERROR' },
}));

const mockStoreContent = vi.fn();
const mockInitializeMessage = vi.fn();

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
    getUnprocessedMessages: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
    getConnectorMessages: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
    initializeMessage: mockInitializeMessage,
    finalizeMessage: vi.fn(),
  },
}));

vi.mock('../global-script.service.js', () => ({ GlobalScriptService: { getAll: vi.fn() } }));
vi.mock('../global-map.service.js', () => ({ GlobalMapService: { list: vi.fn(), upsert: vi.fn() } }));
vi.mock('../config-map.service.js', () => ({ ConfigMapService: { list: vi.fn() } }));
vi.mock('../code-template.service.js', () => ({ CodeTemplateService: { listTemplates: vi.fn() } }));
vi.mock('../alert.service.js', () => ({ AlertService: { list: vi.fn(), getByIds: vi.fn() } }));
vi.mock('../email.service.js', () => ({ EmailService: { sendMail: vi.fn() } }));
vi.mock('../../lib/db.js', () => ({ db: { select: vi.fn(), execute: vi.fn() }, default: {} }));
vi.mock('../../lib/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), level: 'info' } }));
vi.mock('../../lib/socket.js', () => ({ emitToRoom: vi.fn(), emitToAll: vi.fn() }));
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

// ----- storeContent encryption -----

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

    // Stored value is an envelope, not the plaintext PHI.
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

// ----- deploy guard -----

describe('EngineManager.deploy — encryptData key guard', () => {
  function makeChannel(encryptData: boolean): Record<string, unknown> {
    return {
      id: 'ch-guard', name: 'Guarded', encryptData,
      messageStorageMode: 'DEVELOPMENT',
      removeContentOnCompletion: false, removeAttachmentsOnCompletion: false,
      sourceConnectorType: 'TCP_MLLP', sourceConnectorProperties: {},
      inboundDataType: 'HL7V2', destinations: [], scripts: [],
    };
  }

  it('refuses to deploy an encryptData channel when no key is configured', async () => {
    cfg.CONTENT_ENCRYPTION_KEY = undefined;
    const engine = new EngineManager();
    await expect(engine.deploy(makeChannel(true) as never)).rejects.toThrow(/CONTENT_ENCRYPTION_KEY/);
  });
});
