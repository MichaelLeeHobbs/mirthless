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

import { MessageReprocessService } from '../message-reprocess.service.js';
import { db } from '../../lib/db.js';

const mockSelect = vi.mocked(db.select);

// ----- Setup -----

beforeEach(() => {
  mockSelect.mockReset();
  mockTxExecute.mockReset();
  mockTxExecute.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ----- reprocessMessage -----

describe('MessageReprocessService.reprocessMessage', () => {
  it('returns raw content for valid message', async () => {
    const mockWhere = vi.fn().mockResolvedValue([{ content: 'MSH|^~\\&|...' }]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messageId).toBe(1);
      expect(result.value.rawContent).toBe('MSH|^~\\&|...');
    }
  });

  it('returns NOT_FOUND when no raw content exists', async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await MessageReprocessService.reprocessMessage('ch-001', 999);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    }
  });

  it('returns NOT_FOUND when content is null', async () => {
    const mockWhere = vi.fn().mockResolvedValue([{ content: null }]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    }
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
