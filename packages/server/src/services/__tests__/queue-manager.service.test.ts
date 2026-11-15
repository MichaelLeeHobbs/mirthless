// ===========================================
// Queue Manager Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock DB -----

const mockExecute = vi.fn();

const mockDb = {
  execute: mockExecute,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('../../lib/event-emitter.js');

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, type: 'sql' }),
    { raw: (s: string) => ({ raw: s }) },
  ),
}));

// Must import after mocks
const { QueueManagerService } = await import('../queue-manager.service.js');

// ----- Fixtures -----

const CHANNEL_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const META_DATA_ID = 1;

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rows: [] });
});

// ----- Tests -----

describe('QueueManagerService', () => {
  // ========== REQUEUE FAILED ==========
  describe('requeueFailed', () => {
    it('resets ERROR messages under retry limit', async () => {
      mockExecute.mockResolvedValue({
        rows: [
          { count: '3' },
          { count: '3' },
          { count: '3' },
        ],
      });

      const result = await QueueManagerService.requeueFailed(CHANNEL_ID, 5);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.requeuedCount).toBe(3);
      expect(mockExecute).toHaveBeenCalled();
    });

    it('skips messages over retry limit (returns 0)', async () => {
      // When all ERROR messages already exceed maxRetries, no rows match
      mockExecute.mockResolvedValue({ rows: [] });

      const result = await QueueManagerService.requeueFailed(CHANNEL_ID, 0);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.requeuedCount).toBe(0);
    });

    it('handles no failed messages', async () => {
      mockExecute.mockResolvedValue({ rows: [] });

      const result = await QueueManagerService.requeueFailed(CHANNEL_ID, 5);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.requeuedCount).toBe(0);
    });

    it('returns error on DB failure', async () => {
      mockExecute.mockRejectedValue(new Error('DB error'));

      const result = await QueueManagerService.requeueFailed(CHANNEL_ID, 5);

      expect(result.ok).toBe(false);
    });
  });

  // ========== GET QUEUE DEPTH ==========
  describe('getQueueDepth', () => {
    it('returns correct count for queued messages', async () => {
      mockExecute.mockResolvedValue({ rows: [{ count: '15' }] });

      const result = await QueueManagerService.getQueueDepth(CHANNEL_ID, META_DATA_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.depth).toBe(15);
    });

    it('returns 0 for empty queue', async () => {
      mockExecute.mockResolvedValue({ rows: [{ count: '0' }] });

      const result = await QueueManagerService.getQueueDepth(CHANNEL_ID, META_DATA_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.depth).toBe(0);
    });

    it('returns 0 when no rows returned', async () => {
      mockExecute.mockResolvedValue({ rows: [] });

      const result = await QueueManagerService.getQueueDepth(CHANNEL_ID, META_DATA_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.depth).toBe(0);
    });

    it('returns error on DB failure', async () => {
      mockExecute.mockRejectedValue(new Error('Connection refused'));

      const result = await QueueManagerService.getQueueDepth(CHANNEL_ID, META_DATA_ID);

      expect(result.ok).toBe(false);
    });
  });
});
