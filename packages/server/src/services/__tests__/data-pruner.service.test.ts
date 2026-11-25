import { describe, it, expect, vi, beforeEach } from 'vitest';

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
};

const mockDeleteMessagesByIds = vi.fn();
vi.mock('../message-delete-helper.js', () => ({ DELETE_BATCH_SIZE: 1_000, deleteMessagesByIds: mockDeleteMessagesByIds }));
const mockSweep = vi.fn();
vi.mock('../leftover-rows.js', () => ({ SWEEP_BUDGET_MS: { SCHEDULED: 300_000 }, sweepLeftoverRows: mockSweep }));

const mockPruneExpired = vi.fn();
vi.mock('../expired-records.js', () => ({ pruneExpiredRecords: mockPruneExpired }));

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

function isBatchSelect(query: unknown): boolean {
  const strings = (query as { strings?: readonly string[] }).strings ?? [];
  return strings.join('').includes('SELECT m.id FROM messages');
}

// Id batches the pruner reads, in order: one per channel, or several for one channel.
let staleBatches: Array<readonly number[] | Error> = [];
function queueStale(...batches: Array<readonly number[] | Error>): void {
  staleBatches = [...batches];
}
function installExecute(): void {
  mockExecute.mockImplementation(async (query: unknown) => {
    if (!isBatchSelect(query)) return { rows: [] };
    const next = staleBatches.shift() ?? [];
    if (next instanceof Error) throw next;
    return { rows: next.map((id) => ({ id })) };
  });
}

const CHANNEL_ID_1 = '00000000-0000-0000-0000-000000000001';
const CHANNEL_ID_2 = '00000000-0000-0000-0000-000000000002';

beforeEach(() => {
  vi.clearAllMocks();
  resetSelectState();
  staleBatches = [];
  mockDeleteMessagesByIds.mockImplementation((_channelId: string, ids: readonly number[]) => Promise.resolve({ deletedIds: ids, unfinishedIds: [], refusedIds: [] }));
  mockSweep.mockResolvedValue({ rowsDeleted: 0, complete: true, failed: false });
  mockPruneExpired.mockResolvedValue({ deleted: 0, byCollection: {}, complete: true, failed: false });
  installExecute();
  mockDeleteWhere.mockResolvedValue(undefined);
  mockSelectWhere.mockImplementation(() => {
    const fn = selectResponses[selectCallIndex];
    selectCallIndex++;
    if (fn) return fn();
    return [];
  });
});

describe('DataPrunerService', () => {
  describe('pruneChannel', () => {
    it('deletes the old messages and their child rows', async () => {
      queueStale([100, 200, 300]);

      const result = await DataPrunerService.pruneChannel(CHANNEL_ID_1, 7);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.deletedCount).toBe(3);
      expect(mockDeleteMessagesByIds).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID_1, [100, 200, 300], { unfinished: expect.any(Function), queued: false });
      expect((mockDeleteMessagesByIds.mock.calls[0]![2] as { unfinished: () => boolean }).unfinished()).toBe(false);
    });

    it('keeps reading batches until one comes back short', async () => {
      const full = Array.from({ length: 1000 }, (_, i) => i + 1);
      queueStale(full, full.map((id) => id + 1000), [5000]);

      const result = await DataPrunerService.pruneChannel(CHANNEL_ID_1, 7);

      expect(result.ok && result.value.deletedCount).toBe(2001);
      expect(mockDeleteMessagesByIds).toHaveBeenCalledTimes(3);
    });

    it('stops after a full batch when nothing is left', async () => {
      queueStale(Array.from({ length: 1000 }, (_, i) => i + 1), []);

      const result = await DataPrunerService.pruneChannel(CHANNEL_ID_1, 7);

      expect(result.ok && result.value.deletedCount).toBe(1000);
    });

    it('does not count a message that a resend has put back on a queue, and goes on behind it', async () => {
      queueStale(Array.from({ length: 1000 }, (_, i) => i + 1), [2000]);
      mockDeleteMessagesByIds.mockResolvedValueOnce({ deletedIds: [1, 2], unfinishedIds: [], refusedIds: [3] });

      const result = await DataPrunerService.pruneChannel(CHANNEL_ID_1, 7);

      expect(result.ok && result.value.deletedCount).toBe(3);
      const after = mockExecute.mock.calls.map(([query]) => (query as { values: readonly unknown[] }).values.find((v) => typeof v === 'number'));
      expect(after).toEqual([0, 1000]);
    });

    it('returns zero when no messages are old enough', async () => {
      const result = await DataPrunerService.pruneChannel(CHANNEL_ID_1, 30);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.deletedCount).toBe(0);
      expect(mockDeleteMessagesByIds).not.toHaveBeenCalled();
    });

    it('returns error on DB failure during message select', async () => {
      queueStale(new Error('DB connection lost'));

      const result = await DataPrunerService.pruneChannel(CHANNEL_ID_1, 7);

      expect(result.ok).toBe(false);
    });

    it('returns error on DB failure during delete execution', async () => {
      queueStale([100]);
      mockDeleteMessagesByIds.mockRejectedValue(new Error('Delete failed'));

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

  describe('pruneAll', () => {
    it('iterates pruning-enabled channels and aggregates counts', async () => {
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
      expect(result.value).toEqual({ channelsPruned: 1, totalDeleted: 2, failedChannelIds: [CHANNEL_ID_1], leftoverRowsDeleted: 0, leftoverRowsComplete: true, expiredRecordsDeleted: 0, expiredRecordsComplete: true, expiredRecordsFailed: false });
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'FAILURE',
        attributes: expect.objectContaining({ failedChannelIds: [CHANNEL_ID_1] }),
      }));
    });
  });

  describe('pruneAll, for expired collection records', () => {
    beforeEach(() => { pushSelectResponse([]); });

    it('records how many it deleted, by collection', async () => {
      mockPruneExpired.mockResolvedValue({ deleted: 5, byCollection: { k1: 2, k2: 3 }, complete: true, failed: false });

      expect(await DataPrunerService.pruneAll()).toMatchObject({ ok: true, value: { expiredRecordsDeleted: 5, expiredRecordsFailed: false } });
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
        level: 'INFO', outcome: 'SUCCESS',
        attributes: expect.objectContaining({ expiredRecordsDeleted: 5, expiredRecordsByCollection: { k1: 2, k2: 3 }, expiredRecordsComplete: true }),
      }));
    });

    it('records that it did not get to all of them, which is no failure', async () => {
      mockPruneExpired.mockResolvedValue({ deleted: 1_000, byCollection: { k1: 1_000 }, complete: false, failed: false });

      expect(await DataPrunerService.pruneAll(undefined, 30_000)).toMatchObject({ ok: true, value: { expiredRecordsComplete: false } });
      // Run Now is a request that waits for both.
      expect(mockPruneExpired).toHaveBeenCalledExactlyOnceWith(15_000);
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'SUCCESS', attributes: expect.objectContaining({ expiredRecordsComplete: false }) }));
    });

    it('is recorded as failed, with what it deleted before', async () => {
      mockPruneExpired.mockResolvedValue({ deleted: 1_000, byCollection: { k1: 1_000 }, complete: false, failed: true });

      expect(await DataPrunerService.pruneAll()).toMatchObject({ ok: true, value: { expiredRecordsDeleted: 1_000, expiredRecordsFailed: true } });
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
        level: 'ERROR', outcome: 'FAILURE',
        attributes: expect.objectContaining({ expiredRecordsDeleted: 1_000, expiredRecordsByCollection: { k1: 1_000 }, expiredRecordsFailed: true }),
      }));
    });

    it('is not run for one channel', async () => {
      await DataPrunerService.pruneChannel(CHANNEL_ID_1, 30);

      expect(mockPruneExpired).not.toHaveBeenCalled();
    });
  });

  describe('pruneAll, for rows that deleted messages left behind', () => {
    beforeEach(() => { pushSelectResponse([]); });

    it('records how many it deleted', async () => {
      mockSweep.mockResolvedValue({ rowsDeleted: 12, complete: true, failed: false });

      expect(await DataPrunerService.pruneAll()).toMatchObject({ ok: true, value: { leftoverRowsDeleted: 12, leftoverRowsComplete: true } });
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'SUCCESS', attributes: expect.objectContaining({ leftoverRowsDeleted: 12, leftoverRowsComplete: true }) }));
    });

    it('records that it did not get to all of them, which is no failure', async () => {
      mockSweep.mockResolvedValue({ rowsDeleted: 12, complete: false, failed: false });

      expect(await DataPrunerService.pruneAll(undefined, 30_000)).toMatchObject({ ok: true, value: { leftoverRowsComplete: false } });
      expect(mockSweep).toHaveBeenCalledExactlyOnceWith(15_000);
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'SUCCESS', attributes: expect.objectContaining({ leftoverRowsComplete: false }) }));
    });

    it.each([
      ['not all of them could be looked at', (): void => { mockSweep.mockResolvedValue({ rowsDeleted: 3, complete: false, failed: true }); }, 3],
      ['they could not be looked for', (): void => { mockSweep.mockRejectedValue(new Error('db down')); }, 0],
    ])('is recorded as failed when %s', async (_what, given, leftoverRowsDeleted) => {
      given();

      expect(await DataPrunerService.pruneAll()).toMatchObject({ ok: true, value: { leftoverRowsDeleted } });
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ level: 'ERROR', outcome: 'FAILURE' }));
    });
  });

  describe('getStatistics', () => {
    it('returns prunable counts per channel', async () => {
      pushSelectResponse([
        { id: CHANNEL_ID_1, pruningMaxAgeDays: 7 },
        { id: CHANNEL_ID_2, pruningMaxAgeDays: 30 },
      ]);
      mockExecute.mockResolvedValueOnce({ rows: [{ count: '42' }] });
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
