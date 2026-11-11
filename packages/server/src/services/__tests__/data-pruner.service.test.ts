// ===========================================
// Data Pruner Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock DB -----

let selectCallIndex = 0;
let selectResponses: (() => unknown)[] = [];

function resetSelectState(): void {
  selectCallIndex = 0;
  selectResponses = [];
}

function pushSelectResponse(value: unknown, options?: { orderable?: boolean }): void {
  if (options?.orderable) {
    selectResponses.push(() => {
      const result = Promise.resolve(value);
      return Object.assign(result, {
        orderBy: vi.fn().mockReturnValue(value),
      });
    });
  } else {
    selectResponses.push(() => value);
  }
}

const mockSelectWhere = vi.fn().mockImplementation(() => {
  const fn = selectResponses[selectCallIndex];
  selectCallIndex++;
  if (fn) return fn();
  return [];
});

const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDeleteFrom = vi.fn().mockReturnValue({ where: mockDeleteWhere });
const mockDelete = vi.fn().mockReturnValue(mockDeleteFrom);

const mockExecute = vi.fn().mockResolvedValue({ rows: [] });

const mockDb = {
  select: mockSelect,
  delete: mockDelete,
  execute: mockExecute,
  transaction: vi.fn(async (fn: (tx: { execute: typeof mockExecute }) => Promise<void>) => {
    await fn({ execute: mockExecute });
  }),
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('../../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  lt: vi.fn((_col: unknown, val: unknown) => ({ type: 'lt', val })),
  isNull: vi.fn((_col: unknown) => ({ type: 'isNull' })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, type: 'sql' }),
    {
      raw: (s: string) => ({ raw: s }),
      identifier: (name: string) => ({ identifier: name }),
      join: (chunks: unknown[], sep: unknown) => ({ type: 'sql_join', chunks, sep }),
    },
  ),
}));

// Must import after mocks
const { DataPrunerService } = await import('../data-pruner.service.js');
const { emitEvent } = await import('../../lib/event-emitter.js');

// ----- Fixtures -----

/** True when a mocked sql`` object is the pruner's "next batch of ids" query. */
function isBatchSelect(query: unknown): boolean {
  const strings = (query as { strings?: readonly string[] }).strings ?? [];
  return strings.join('').includes('SELECT m.id FROM messages');
}

/**
 * Queue the id batches the pruner will read, in order (one per channel, or several
 * for one channel). A batch may be an Error to make that read fail. Every other
 * statement (the deletes) succeeds unless a test overrides it.
 */
let staleBatches: Array<readonly number[] | Error> = [];
let deleteStatements = 0;
function queueStale(...batches: Array<readonly number[] | Error>): void {
  staleBatches = [...batches];
}
function installExecute(): void {
  mockExecute.mockImplementation(async (query: unknown) => {
    if (!isBatchSelect(query)) { deleteStatements += 1; return { rows: [] }; }
    const next = staleBatches.shift() ?? [];
    if (next instanceof Error) throw next;
    return { rows: next.map((id) => ({ id })) };
  });
}

const CHANNEL_ID_1 = '00000000-0000-0000-0000-000000000001';
const CHANNEL_ID_2 = '00000000-0000-0000-0000-000000000002';

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
  resetSelectState();
  staleBatches = [];
  deleteStatements = 0;
  installExecute();
  mockDeleteWhere.mockResolvedValue(undefined);
  mockSelectWhere.mockImplementation(() => {
    const fn = selectResponses[selectCallIndex];
    selectCallIndex++;
    if (fn) return fn();
    return [];
  });
});

// ----- Tests -----

describe('DataPrunerService', () => {
  // ========== PRUNE CHANNEL ==========
  describe('pruneChannel', () => {
    it('deletes the old messages and their child rows', async () => {
      queueStale([100, 200, 300]);

      const result = await DataPrunerService.pruneChannel(CHANNEL_ID_1, 7);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.deletedCount).toBe(3);
      // attachments, custom metadata, content, connector_messages, messages
      expect(deleteStatements).toBe(5);
    });

    it('keeps reading batches until one comes back short', async () => {
      const full = Array.from({ length: 1000 }, (_, i) => i + 1);
      queueStale(full, full.map((id) => id + 1000), [5000]);

      const result = await DataPrunerService.pruneChannel(CHANNEL_ID_1, 7);

      expect(result.ok && result.value.deletedCount).toBe(2001);
      expect(deleteStatements).toBe(15);
    });

    it('stops after a full batch when nothing is left', async () => {
      queueStale(Array.from({ length: 1000 }, (_, i) => i + 1), []);

      const result = await DataPrunerService.pruneChannel(CHANNEL_ID_1, 7);

      expect(result.ok && result.value.deletedCount).toBe(1000);
    });

    it('returns zero when no messages are old enough', async () => {
      const result = await DataPrunerService.pruneChannel(CHANNEL_ID_1, 30);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.deletedCount).toBe(0);
      expect(deleteStatements).toBe(0);
    });

    it('returns error on DB failure during message select', async () => {
      queueStale(new Error('DB connection lost'));

      const result = await DataPrunerService.pruneChannel(CHANNEL_ID_1, 7);

      expect(result.ok).toBe(false);
    });

    it('returns error on DB failure during delete execution', async () => {
      mockExecute.mockImplementation(async (query: unknown) => {
        if (isBatchSelect(query)) return { rows: [{ id: 100 }] };
        throw new Error('Delete failed');
      });

      const result = await DataPrunerService.pruneChannel(CHANNEL_ID_1, 7);

      expect(result.ok).toBe(false);
    });

    it('emits audit event on success', async () => {
      queueStale([100]);

      const context = { userId: 'user-1', ipAddress: '127.0.0.1' };
      const result = await DataPrunerService.pruneChannel(CHANNEL_ID_1, 14, context);

      expect(result.ok).toBe(true);
      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'DATA_PRUNER_RAN',
          channelId: CHANNEL_ID_1,
          userId: 'user-1',
          attributes: expect.objectContaining({ maxAgeDays: 14, deletedCount: 1 }),
        }),
      );
    });
  });

  // ========== PRUNE ALL ==========
  describe('pruneAll', () => {
    it('iterates pruning-enabled channels and aggregates counts', async () => {
      // First call: fetch prunable channels
      pushSelectResponse([
        { id: CHANNEL_ID_1, pruningMaxAgeDays: 7 },
        { id: CHANNEL_ID_2, pruningMaxAgeDays: 14 },
      ]);
      queueStale([100, 200], [300]);

      const result = await DataPrunerService.pruneAll();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.channelsPruned).toBe(2);
      expect(result.value.totalDeleted).toBe(3);
    });

    it('returns zero when no channels have pruning enabled', async () => {
      pushSelectResponse([]);

      const result = await DataPrunerService.pruneAll();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.channelsPruned).toBe(0);
      expect(result.value.totalDeleted).toBe(0);
    });

    it('uses default 30-day retention when pruningMaxAgeDays is null', async () => {
      pushSelectResponse([{ id: CHANNEL_ID_1, pruningMaxAgeDays: null }]);
      queueStale([500]);

      const result = await DataPrunerService.pruneAll();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.totalDeleted).toBe(1);
    });

    it('does not count channels with zero deleted messages', async () => {
      pushSelectResponse([
        { id: CHANNEL_ID_1, pruningMaxAgeDays: 7 },
        { id: CHANNEL_ID_2, pruningMaxAgeDays: 14 },
      ]);
      queueStale([100], []);

      const result = await DataPrunerService.pruneAll();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.channelsPruned).toBe(1);
      expect(result.value.totalDeleted).toBe(1);
    });

    it('returns error on DB failure', async () => {
      selectResponses.push(() => {
        throw new Error('DB error');
      });

      const result = await DataPrunerService.pruneAll();

      expect(result.ok).toBe(false);
    });

    it('emits audit event with aggregate counts', async () => {
      pushSelectResponse([{ id: CHANNEL_ID_1, pruningMaxAgeDays: 7 }]);
      queueStale([100, 200]);

      await DataPrunerService.pruneAll({ userId: 'admin-1', ipAddress: '10.0.0.1' });

      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'DATA_PRUNER_RAN',
          channelId: null,
          userId: 'admin-1',
          attributes: expect.objectContaining({ channelsPruned: 1, totalDeleted: 2 }),
        }),
      );
    });
  
    it('keeps pruning the other channels when one channel fails', async () => {
      pushSelectResponse([
        { id: CHANNEL_ID_1, pruningMaxAgeDays: 7 },
        { id: CHANNEL_ID_2, pruningMaxAgeDays: 14 },
      ]);
      queueStale(new Error('lock timeout'), [300, 400]);

      const result = await DataPrunerService.pruneAll();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ channelsPruned: 1, totalDeleted: 2, failedChannelIds: [CHANNEL_ID_1] });
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'FAILURE',
        attributes: expect.objectContaining({ failedChannelIds: [CHANNEL_ID_1] }),
      }));
    });
  });

  // ========== GET STATISTICS ==========
  describe('getStatistics', () => {
    it('returns prunable counts per channel', async () => {
      pushSelectResponse([
        { id: CHANNEL_ID_1, pruningMaxAgeDays: 7 },
        { id: CHANNEL_ID_2, pruningMaxAgeDays: 30 },
      ]);
      // execute for channel 1 count
      mockExecute.mockResolvedValueOnce({ rows: [{ count: '42' }] });
      // execute for channel 2 count
      mockExecute.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const result = await DataPrunerService.getStatistics();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(result.value[0]).toEqual({ channelId: CHANNEL_ID_1, prunableCount: 42 });
      expect(result.value[1]).toEqual({ channelId: CHANNEL_ID_2, prunableCount: 0 });
    });

    it('returns empty array when no channels have pruning enabled', async () => {
      pushSelectResponse([]);

      const result = await DataPrunerService.getStatistics();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it('uses default 30-day max age when pruningMaxAgeDays is null', async () => {
      pushSelectResponse([{ id: CHANNEL_ID_1, pruningMaxAgeDays: null }]);
      mockExecute.mockResolvedValueOnce({ rows: [{ count: '5' }] });

      const result = await DataPrunerService.getStatistics();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.prunableCount).toBe(5);
    });

    it('returns error on DB failure during channel query', async () => {
      selectResponses.push(() => {
        throw new Error('DB error');
      });

      const result = await DataPrunerService.getStatistics();

      expect(result.ok).toBe(false);
    });

    it('returns error on DB failure during count query', async () => {
      pushSelectResponse([{ id: CHANNEL_ID_1, pruningMaxAgeDays: 7 }]);
      mockExecute.mockRejectedValueOnce(new Error('Count failed'));

      const result = await DataPrunerService.getStatistics();

      expect(result.ok).toBe(false);
    });
  });
});
