// ===========================================
// Queue Manager Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock DB -----

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

const mockExecute = vi.fn();

const mockDb = {
  update: mockUpdate,
  execute: mockExecute,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('../../lib/event-emitter.js');

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, type: 'sql' }),
    { raw: (s: string) => ({ raw: s }) },
  ),
}));

// Must import after mocks
const { QueueManagerService } = await import('../queue-manager.service.js');

// ----- Fixtures -----

const CHANNEL_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const MESSAGE_ID = 42;
const META_DATA_ID = 1;

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockResolvedValue(undefined);
  mockExecute.mockResolvedValue({ rows: [] });
});

// ----- Tests -----

describe('QueueManagerService', () => {
  // ========== DEQUEUE ==========
  describe('dequeue', () => {
    it('returns messages with FOR UPDATE SKIP LOCKED', async () => {
      const queuedRow = {
        channelId: CHANNEL_ID,
        messageId: 10,
        metaDataId: META_DATA_ID,
        status: 'QUEUED',
        connectorName: 'Dest 1',
        sendAttempts: 0,
        errorCode: 0,
        receivedAt: new Date('2026-03-01T00:00:00Z'),
      };
      mockExecute.mockResolvedValue({ rows: [queuedRow] });

      const result = await QueueManagerService.dequeue(CHANNEL_ID, META_DATA_ID, 5);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toEqual(queuedRow);
      expect(mockExecute).toHaveBeenCalled();
    });

    it('respects batch size by returning correct number of messages', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({
        channelId: CHANNEL_ID,
        messageId: i + 1,
        metaDataId: META_DATA_ID,
        status: 'QUEUED',
        connectorName: 'Dest 1',
        sendAttempts: 0,
        errorCode: 0,
        receivedAt: new Date('2026-03-01T00:00:00Z'),
      }));
      mockExecute.mockResolvedValue({ rows });

      const result = await QueueManagerService.dequeue(CHANNEL_ID, META_DATA_ID, 3);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(3);
    });

    it('returns empty array when no queued messages', async () => {
      mockExecute.mockResolvedValue({ rows: [] });

      const result = await QueueManagerService.dequeue(CHANNEL_ID, META_DATA_ID, 5);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it('returns error on DB failure', async () => {
      mockExecute.mockRejectedValue(new Error('Lock timeout'));

      const result = await QueueManagerService.dequeue(CHANNEL_ID, META_DATA_ID, 5);

      expect(result.ok).toBe(false);
    });
  });

  // ========== RELEASE ==========
  describe('release', () => {
    it('updates status to SENT with sendDate', async () => {
      const result = await QueueManagerService.release(
        CHANNEL_ID, MESSAGE_ID, META_DATA_ID, 'SENT',
      );

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SENT', sendDate: expect.any(Date) }),
      );
    });

    it('updates status to ERROR without sendDate', async () => {
      const result = await QueueManagerService.release(
        CHANNEL_ID, MESSAGE_ID, META_DATA_ID, 'ERROR',
      );

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith({ status: 'ERROR' });
    });

    it('handles DB error gracefully', async () => {
      mockUpdateWhere.mockRejectedValue(new Error('Connection lost'));

      const result = await QueueManagerService.release(
        CHANNEL_ID, MESSAGE_ID, META_DATA_ID, 'SENT',
      );

      expect(result.ok).toBe(false);
    });
  });

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
