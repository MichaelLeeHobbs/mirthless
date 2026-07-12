// ===========================================
// Message Reprocess Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB and event emitter
const mockTxExecute = vi.fn();

vi.mock('../../lib/db.js', () => ({
  db: {
    select: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(async (fn: (tx: { execute: typeof mockTxExecute }) => Promise<void>) => {
      await fn({ execute: mockTxExecute });
    }),
  },
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

const mockGetRuntime = vi.fn();
vi.mock('../../engine.js', () => ({
  getEngine: () => ({ getRuntime: mockGetRuntime }),
}));

import { MessageReprocessService } from '../message-reprocess.service.js';
import { db } from '../../lib/db.js';

const mockSelect = vi.mocked(db.select);

/** A deployed channel whose pipeline accepts a re-injected message. */
function deployedChannel(state: string, processMessage: ReturnType<typeof vi.fn>) {
  return { runtime: { getState: () => state }, processMessage };
}

function mockRawContent(content: string | null): void {
  const mockWhere = vi.fn().mockResolvedValue(content === null ? [] : [{ content }]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom } as never);
}

// ----- Setup -----

beforeEach(() => {
  mockSelect.mockReset();
  mockGetRuntime.mockReset();
  mockTxExecute.mockReset();
  mockTxExecute.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ----- reprocessMessage -----

describe('MessageReprocessService.reprocessMessage', () => {
  it('re-injects raw content through the deployed channel and returns the new message id', async () => {
    mockRawContent('MSH|^~\\&|...');
    const processMessage = vi.fn().mockResolvedValue({ ok: true, value: { messageId: 42, status: 'PROCESSED' }, error: null });
    mockGetRuntime.mockReturnValue(deployedChannel('STARTED', processMessage));

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messageId).toBe(1);
      expect(result.value.newMessageId).toBe(42);
    }
    // Re-injected the exact stored raw content
    expect(processMessage).toHaveBeenCalledWith('MSH|^~\\&|...', { reprocessedFrom: 1 });
  });

  it('returns NOT_FOUND when no raw content exists', async () => {
    mockRawContent(null);

    const result = await MessageReprocessService.reprocessMessage('ch-001', 999);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    }
  });

  it('returns NOT_FOUND when content is null', async () => {
    mockRawContent(null);

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    }
  });

  it('returns CONFLICT when the channel is not deployed', async () => {
    mockRawContent('MSH|...');
    mockGetRuntime.mockReturnValue(undefined);

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    }
  });

  it('returns CONFLICT when the channel is deployed but not STARTED', async () => {
    mockRawContent('MSH|...');
    mockGetRuntime.mockReturnValue(deployedChannel('STOPPED', vi.fn()));

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    }
  });

  it('returns error when the pipeline rejects the re-injected message', async () => {
    mockRawContent('MSH|...');
    const processMessage = vi.fn().mockResolvedValue({ ok: false, value: null, error: { message: 'pipeline error' } });
    mockGetRuntime.mockReturnValue(deployedChannel('STARTED', processMessage));

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(false);
  });

  it('returns error on DB failure', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockRejectedValue(new Error('Timeout')),
    });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(false);
  });
});

// ----- bulkDelete -----

describe('MessageReprocessService.bulkDelete', () => {
  it('deletes messages in dependency order', async () => {
    const mockWhere = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await MessageReprocessService.bulkDelete('ch-001', [1, 2]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.deletedCount).toBe(2);
    }
    // 5 dependency-order deletes inside transaction
    expect(mockTxExecute).toHaveBeenCalledTimes(5);
  });

  it('returns NOT_FOUND when no messages match', async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await MessageReprocessService.bulkDelete('ch-001', [999]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    }
  });

  it('returns zero for empty messageIds array', async () => {
    const result = await MessageReprocessService.bulkDelete('ch-001', []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.deletedCount).toBe(0);
    }
  });

  it('handles partial match — only deletes existing messages', async () => {
    const mockWhere = vi.fn().mockResolvedValue([{ id: 1 }]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await MessageReprocessService.bulkDelete('ch-001', [1, 999]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.deletedCount).toBe(1);
    }
  });

  it('returns error on DB failure during delete', async () => {
    const mockWhere = vi.fn().mockResolvedValue([{ id: 1 }]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);
    mockTxExecute.mockRejectedValue(new Error('Connection lost'));

    const result = await MessageReprocessService.bulkDelete('ch-001', [1]);

    expect(result.ok).toBe(false);
  });
});
