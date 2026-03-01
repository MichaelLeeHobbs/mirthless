// ===========================================
// Partition Manager Service Tests
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

vi.mock('../../lib/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Must import after mocks
const { PartitionManagerService } = await import('../partition-manager.service.js');

// ----- Fixtures -----

const CHANNEL_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const SANITIZED_ID = 'a0eebc99_9c0b_4ef8_bb6d_6bb9bd380a11';

const PARTITIONED_TABLES = [
  'messages',
  'connector_messages',
  'message_content',
  'message_statistics',
  'message_attachments',
  'message_custom_metadata',
] as const;

// ----- Tests -----

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rows: [] });
});

describe('PartitionManagerService', () => {
  // ========== CREATE PARTITIONS ==========
  describe('createPartitions', () => {
    it('generates CREATE TABLE IF NOT EXISTS for each partitioned table', async () => {
      const result = await PartitionManagerService.createPartitions(CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockExecute).toHaveBeenCalledTimes(PARTITIONED_TABLES.length);

      for (let i = 0; i < PARTITIONED_TABLES.length; i++) {
        const table = PARTITIONED_TABLES[i]!;
        const call = mockExecute.mock.calls[i]!;
        const sqlObj = call[0] as { queryChunks: ReadonlyArray<{ value: readonly string[] }> };
        // sql.raw wraps the string in queryChunks
        const rawSql = sqlObj.queryChunks[0]!.value[0]!;
        expect(rawSql).toContain('CREATE TABLE IF NOT EXISTS');
        expect(rawSql).toContain(`"${table}_p_${SANITIZED_ID}"`);
        expect(rawSql).toContain(`PARTITION OF "${table}"`);
        expect(rawSql).toContain(`FOR VALUES IN ('${CHANNEL_ID}')`);
      }
    });

    it('sanitizes channel ID by replacing hyphens with underscores in table name', async () => {
      const result = await PartitionManagerService.createPartitions(CHANNEL_ID);

      expect(result.ok).toBe(true);
      const call = mockExecute.mock.calls[0]!;
      const sqlObj = call[0] as { queryChunks: ReadonlyArray<{ value: readonly string[] }> };
      const rawSql = sqlObj.queryChunks[0]!.value[0]!;
      // Partition table name should use underscores (sanitized)
      expect(rawSql).toContain(`"messages_p_${SANITIZED_ID}"`);
      // The FOR VALUES IN clause should still use the original UUID with hyphens
      expect(rawSql).toContain(`FOR VALUES IN ('${CHANNEL_ID}')`);
    });

    it('returns error when db.execute fails', async () => {
      mockExecute.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await PartitionManagerService.createPartitions(CHANNEL_ID);

      expect(result.ok).toBe(false);
    });

    it('returns error when second table creation fails', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('Permission denied'));

      const result = await PartitionManagerService.createPartitions(CHANNEL_ID);

      expect(result.ok).toBe(false);
      // First call succeeded, second failed
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });
  });

  // ========== DROP PARTITIONS ==========
  describe('dropPartitions', () => {
    it('generates DROP TABLE IF EXISTS CASCADE for each partitioned table', async () => {
      const result = await PartitionManagerService.dropPartitions(CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockExecute).toHaveBeenCalledTimes(PARTITIONED_TABLES.length);

      for (let i = 0; i < PARTITIONED_TABLES.length; i++) {
        const table = PARTITIONED_TABLES[i]!;
        const call = mockExecute.mock.calls[i]!;
        const sqlObj = call[0] as { queryChunks: ReadonlyArray<{ value: readonly string[] }> };
        const rawSql = sqlObj.queryChunks[0]!.value[0]!;
        expect(rawSql).toContain('DROP TABLE IF EXISTS');
        expect(rawSql).toContain(`"${table}_p_${SANITIZED_ID}"`);
        expect(rawSql).toContain('CASCADE');
      }
    });

    it('sanitizes channel ID in drop statements', async () => {
      const result = await PartitionManagerService.dropPartitions(CHANNEL_ID);

      expect(result.ok).toBe(true);
      const call = mockExecute.mock.calls[0]!;
      const sqlObj = call[0] as { queryChunks: ReadonlyArray<{ value: readonly string[] }> };
      const rawSql = sqlObj.queryChunks[0]!.value[0]!;
      expect(rawSql).toContain(SANITIZED_ID);
    });

    it('returns error when db.execute fails', async () => {
      mockExecute.mockRejectedValueOnce(new Error('Connection lost'));

      const result = await PartitionManagerService.dropPartitions(CHANNEL_ID);

      expect(result.ok).toBe(false);
    });
  });

  // ========== PARTITION EXISTS ==========
  describe('partitionExists', () => {
    it('returns true when partition exists', async () => {
      mockExecute.mockResolvedValueOnce({
        rows: [{ exists: true }],
      });

      const result = await PartitionManagerService.partitionExists(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(true);

      const call = mockExecute.mock.calls[0]!;
      const sqlObj = call[0] as { queryChunks: ReadonlyArray<{ value: readonly string[] }> };
      const rawSql = sqlObj.queryChunks[0]!.value[0]!;
      expect(rawSql).toContain('pg_tables');
      expect(rawSql).toContain(`messages_p_${SANITIZED_ID}`);
    });

    it('returns false when partition does not exist', async () => {
      mockExecute.mockResolvedValueOnce({
        rows: [{ exists: false }],
      });

      const result = await PartitionManagerService.partitionExists(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(false);
    });

    it('returns false when query returns empty rows', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });

      const result = await PartitionManagerService.partitionExists(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(false);
    });

    it('returns error when db.execute fails', async () => {
      mockExecute.mockRejectedValueOnce(new Error('Query timeout'));

      const result = await PartitionManagerService.partitionExists(CHANNEL_ID);

      expect(result.ok).toBe(false);
    });
  });
});
