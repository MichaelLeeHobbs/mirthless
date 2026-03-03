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
  compileScript: vi.fn(),
  compileFilterRulesToScript: vi.fn(),
  compileTransformerStepsToScript: vi.fn(),
  prependTemplates: vi.fn(),
  AlertManager: vi.fn(),
  QueueConsumer: vi.fn(),
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
const { shouldStoreContent } = await import('../../engine.js');

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

  it('PRODUCTION stores only error types (11-13)', () => {
    for (const ct of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(shouldStoreContent('PRODUCTION', ct)).toBe(false);
    }
    for (const ct of [11, 12, 13]) {
      expect(shouldStoreContent('PRODUCTION', ct)).toBe(true);
    }
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
