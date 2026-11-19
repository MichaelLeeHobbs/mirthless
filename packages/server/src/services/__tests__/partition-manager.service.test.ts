import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

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

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rows: [] });
});

describe('PartitionManagerService.ensureAuditPartitions', () => {
  it('calls the owner function, which takes no argument, and returns how many partitions it made', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ made: 2, failed: [] }] });

    const result = await PartitionManagerService.ensureAuditPartitions();

    expect(result).toMatchObject({ ok: true, value: 2 });
    const query = new PgDialect().sqlToQuery(mockExecute.mock.calls[0]![0] as SQL);
    expect(query.sql).toBe('SELECT made, failed FROM public.ensure_audit_partitions()');
    expect(query.params).toEqual([]);
  });

  it('fails naming the months the function could not make, so the step shows degraded', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ made: 3, failed: ['2027-03: updated partition constraint for default partition would be violated'] }] });

    const result = await PartitionManagerService.ensureAuditPartitions();

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('2027-03: updated partition constraint');
  });

  it('fails when the function fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('permission denied for function ensure_audit_partitions'));

    expect((await PartitionManagerService.ensureAuditPartitions()).ok).toBe(false);
  });
});

describe('PartitionManagerService', () => {
  describe('createPartitions', () => {
    it('creates them through the owner function, passing the channel id as a parameter', async () => {
      const result = await PartitionManagerService.createPartitions(CHANNEL_ID);

      expect(result.ok).toBe(true);
      // The server's role does not own the parent tables, so it cannot run
      // CREATE TABLE ... PARTITION OF itself (D-307).
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const query = new PgDialect().sqlToQuery(mockExecute.mock.calls[0]![0] as SQL);
      expect(query.sql).toBe('SELECT public.create_channel_partitions($1::uuid)');
      expect(query.params).toEqual([CHANNEL_ID]);
    });

    it('runs on the transaction it is given, not the global db (#260)', async () => {
      const txExecute = vi.fn().mockResolvedValue({ rows: [] });

      const result = await PartitionManagerService.createPartitions(CHANNEL_ID, { execute: txExecute } as never);

      expect(result.ok).toBe(true);
      expect(txExecute).toHaveBeenCalledTimes(1);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('returns error when db.execute fails', async () => {
      mockExecute.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await PartitionManagerService.createPartitions(CHANNEL_ID);

      expect(result.ok).toBe(false);
    });
  });

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
