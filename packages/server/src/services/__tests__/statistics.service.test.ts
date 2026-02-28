// ===========================================
// Statistics Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock DB -----

let selectCallIndex = 0;
let selectResponses: (() => unknown)[] = [];

function resetSelectState(): void {
  selectCallIndex = 0;
  selectResponses = [];
}

function pushSelectResponse(value: unknown): void {
  selectResponses.push(() => value);
}

const mockSelectWhere = vi.fn().mockImplementation(() => {
  const fn = selectResponses[selectCallIndex];
  selectCallIndex++;
  if (fn) return fn();
  return [];
});

const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

const mockExecute = vi.fn();

const mockDb = {
  select: mockSelect,
  update: mockUpdate,
  execute: mockExecute,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, type: 'sql' }),
    { raw: (s: string) => ({ raw: s }) },
  ),
}));

// Must import after mocks
const { StatisticsService } = await import('../statistics.service.js');

// ----- Fixtures -----

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const SERVER_ID = 'server-01';

function makeStatsRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    channelId: CHANNEL_ID,
    metaDataId: 0,
    serverId: SERVER_ID,
    received: 10,
    filtered: 2,
    sent: 8,
    errored: 0,
    receivedLifetime: 100,
    filteredLifetime: 20,
    sentLifetime: 80,
    erroredLifetime: 0,
    ...overrides,
  };
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
  resetSelectState();
  mockExecute.mockResolvedValue({ rows: [] });
  mockUpdateWhere.mockResolvedValue(undefined);
  mockSet.mockReturnValue({ where: mockUpdateWhere });
});

// ----- Tests -----

describe('StatisticsService', () => {
  // ========== GET CHANNEL STATISTICS ==========
  describe('getChannelStatistics', () => {
    it('returns per-channel stats with connector breakdown', async () => {
      pushSelectResponse([
        makeStatsRow({ metaDataId: 0 }),
        makeStatsRow({ metaDataId: 1, received: 0, sent: 7, errored: 1 }),
      ]);

      const result = await StatisticsService.getChannelStatistics(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.channelId).toBe(CHANNEL_ID);
      expect(result.value.connectors).toHaveLength(2);
      expect(result.value.connectors[0]!.metaDataId).toBe(0);
      expect(result.value.connectors[1]!.metaDataId).toBe(1);
    });

    it('returns empty connectors when no data exists', async () => {
      pushSelectResponse([]);

      const result = await StatisticsService.getChannelStatistics(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.connectors).toHaveLength(0);
    });

    it('returns error on DB failure', async () => {
      selectResponses.push(() => {
        throw new Error('DB error');
      });

      const result = await StatisticsService.getChannelStatistics(CHANNEL_ID);

      expect(result.ok).toBe(false);
    });
  });

  // ========== GET ALL CHANNEL STATISTICS ==========
  describe('getAllChannelStatistics', () => {
    it('returns summary for all channels', async () => {
      mockExecute.mockResolvedValue({
        rows: [
          {
            channel_id: CHANNEL_ID,
            channel_name: 'HL7 Router',
            enabled: true,
            received: '100',
            filtered: '10',
            sent: '88',
            errored: '2',
            queued: '5',
          },
        ],
      });

      const result = await StatisticsService.getAllChannelStatistics();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.channelName).toBe('HL7 Router');
      expect(result.value[0]!.received).toBe(100);
      expect(result.value[0]!.queued).toBe(5);
    });

    it('returns empty array when no channels exist', async () => {
      mockExecute.mockResolvedValue({ rows: [] });

      const result = await StatisticsService.getAllChannelStatistics();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it('returns error on DB failure', async () => {
      mockExecute.mockRejectedValue(new Error('DB error'));

      const result = await StatisticsService.getAllChannelStatistics();

      expect(result.ok).toBe(false);
    });
  });

  // ========== RESET STATISTICS ==========
  describe('resetStatistics', () => {
    it('resets current-window counters to zero', async () => {
      const result = await StatisticsService.resetStatistics(CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith({
        received: 0,
        filtered: 0,
        sent: 0,
        errored: 0,
      });
    });

    it('succeeds even when no stats exist for channel', async () => {
      const result = await StatisticsService.resetStatistics(CHANNEL_ID);

      expect(result.ok).toBe(true);
    });

    it('returns error on DB failure', async () => {
      mockUpdateWhere.mockRejectedValue(new Error('DB error'));

      const result = await StatisticsService.resetStatistics(CHANNEL_ID);

      expect(result.ok).toBe(false);
    });
  });
});
