// ===========================================
// Engine Storage Policy Tests
// ===========================================
// Tests for shouldStoreContent() and the per-channel message store adapter.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock Dependencies -----

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
}));

const mockStoreContent = vi.fn();
const mockMarkProcessed = vi.fn();
const mockDeleteContent = vi.fn();
const mockDeleteAttachments = vi.fn();

vi.mock('../message.service.js', () => ({
  MessageService: {
    createMessage: vi.fn(),
    createConnectorMessage: vi.fn(),
    updateConnectorMessageStatus: vi.fn(),
    storeContent: mockStoreContent,
    markProcessed: mockMarkProcessed,
    enqueue: vi.fn(),
    loadContent: vi.fn(),
    incrementStats: vi.fn(),
    dequeue: vi.fn(),
    release: vi.fn(),
    deleteContent: mockDeleteContent,
    deleteAttachments: mockDeleteAttachments,
    resetPending: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    getUnprocessedMessages: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
    getConnectorMessages: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }),
  },
}));

vi.mock('../global-script.service.js', () => ({ GlobalScriptService: { getAll: vi.fn() } }));
vi.mock('../code-template.service.js', () => ({ CodeTemplateService: { listTemplates: vi.fn() } }));
vi.mock('../alert.service.js', () => ({ AlertService: { list: vi.fn(), getByIds: vi.fn() } }));
vi.mock('../email.service.js', () => ({ EmailService: { sendMail: vi.fn() } }));
vi.mock('../../lib/db.js', () => ({ db: { select: vi.fn(), execute: vi.fn() }, default: {} }));
vi.mock('../../lib/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/socket.js', () => ({ emitToRoom: vi.fn(), emitToAll: vi.fn() }));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  asc: vi.fn(),
  and: vi.fn(),
  sql: Object.assign(() => ({}), { raw: () => ({}) }),
}));

// Must import after mocks
const { shouldStoreContent, storageModeSupportsQueue } = await import('../../engine.js');

// ----- Helpers -----

function ok<T>(value: T): { ok: true; value: T; error: null } {
  return { ok: true, value, error: null };
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreContent.mockResolvedValue(ok(undefined));
  mockMarkProcessed.mockResolvedValue(ok(undefined));
  mockDeleteContent.mockResolvedValue(ok(undefined));
  mockDeleteAttachments.mockResolvedValue(ok(undefined));
});

// ----- shouldStoreContent tests -----

describe('shouldStoreContent', () => {
  it('DEVELOPMENT stores all content types', () => {
    for (const ct of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      expect(shouldStoreContent('DEVELOPMENT', ct)).toBe(true);
    }
  });

  it('PRODUCTION stores delivery/recovery/browser content (raw, transformed, encoded, sent, response*) and errors', () => {
    // Stored: RAW(1), TRANSFORMED(3), ENCODED(4), SENT(5), RESPONSE(6),
    // RESPONSE_TRANSFORMED(7), RESPONSE_SENT(8), and errors(11-13).
    for (const ct of [1, 3, 4, 5, 6, 7, 8, 11, 12, 13]) {
      expect(shouldStoreContent('PRODUCTION', ct)).toBe(true);
    }
    // Not stored: PROCESSED(2) debug copy, SOURCE_MAP(9), CHANNEL_MAP(10).
    for (const ct of [2, 9, 10]) {
      expect(shouldStoreContent('PRODUCTION', ct)).toBe(false);
    }
  });

  it('PRODUCTION persists RAW+SENT so queued delivery and crash recovery work', () => {
    // RAW(1) required for reprocess/recovery; SENT(5) required for queued delivery.
    expect(shouldStoreContent('PRODUCTION', 1)).toBe(true);
    expect(shouldStoreContent('PRODUCTION', 5)).toBe(true);
    // RAW mode keeps RAW but not SENT — cannot support a queued destination.
    expect(shouldStoreContent('RAW', 1)).toBe(true);
    expect(shouldStoreContent('RAW', 5)).toBe(false);
  });

  it('RAW stores raw (1) and errors (11-13)', () => {
    expect(shouldStoreContent('RAW', 1)).toBe(true);
    for (const ct of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(shouldStoreContent('RAW', ct)).toBe(false);
    }
    for (const ct of [11, 12, 13]) {
      expect(shouldStoreContent('RAW', ct)).toBe(true);
    }
  });

  it('METADATA stores nothing', () => {
    for (const ct of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      expect(shouldStoreContent('METADATA', ct)).toBe(false);
    }
  });

  it('DISABLED stores nothing', () => {
    for (const ct of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      expect(shouldStoreContent('DISABLED', ct)).toBe(false);
    }
  });
});

describe('storageModeSupportsQueue', () => {
  it('DEVELOPMENT and PRODUCTION support queued destinations (store RAW+SENT)', () => {
    expect(storageModeSupportsQueue('DEVELOPMENT')).toBe(true);
    expect(storageModeSupportsQueue('PRODUCTION')).toBe(true);
  });

  it('RAW, METADATA, DISABLED cannot support queued destinations', () => {
    // These do not persist CT_SENT, so a queued destination would reload null
    // content and error 100% of messages.
    expect(storageModeSupportsQueue('RAW')).toBe(false);
    expect(storageModeSupportsQueue('METADATA')).toBe(false);
    expect(storageModeSupportsQueue('DISABLED')).toBe(false);
  });
});
