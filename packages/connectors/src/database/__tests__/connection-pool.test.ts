// ===========================================
// Connection Pool Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionPool, type PoolConfig } from '../connection-pool.js';

// ----- Mock pg -----

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockRelease = vi.fn();

vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: mockConnect,
    end: mockEnd,
  }));

  return { default: { Pool: MockPool }, Pool: MockPool };
});

// ----- Helpers -----

function makePoolConfig(overrides?: Partial<PoolConfig>): PoolConfig {
  return {
    host: 'localhost',
    port: 5432,
    database: 'testdb',
    user: 'testuser',
    password: 'testpass',
    maxConnections: 5,
    idleTimeoutMs: 30_000,
    connectionTimeoutMs: 10_000,
    ...overrides,
  };
}

// ----- Lifecycle -----

let pool: ConnectionPool | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: connect returns a client that can be released
  mockConnect.mockResolvedValue({ release: mockRelease });
  mockEnd.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (pool) {
    await pool.destroy();
    pool = null;
  }
});

// ----- Tests -----

describe('ConnectionPool', () => {
  describe('create', () => {
    it('creates pool and verifies connectivity', async () => {
      pool = new ConnectionPool();
      const result = await pool.create(makePoolConfig());

      expect(result.ok).toBe(true);
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('returns error when connectivity check fails', async () => {
      mockConnect.mockRejectedValue(new Error('Connection refused'));

      pool = new ConnectionPool();
      const result = await pool.create(makePoolConfig());

      expect(result.ok).toBe(false);
    });
  });

  describe('query', () => {
    it('executes query and returns rows', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 1, name: 'test' }],
        rowCount: 1,
      });

      pool = new ConnectionPool();
      await pool.create(makePoolConfig());

      const result = await pool.query('SELECT * FROM t WHERE id = $1', [1]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.rows).toEqual([{ id: 1, name: 'test' }]);
      expect(result.value.rowCount).toBe(1);
    });

    it('passes params to pg query', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      pool = new ConnectionPool();
      await pool.create(makePoolConfig());

      await pool.query('SELECT * FROM t WHERE a = $1 AND b = $2', ['val1', 42]);

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM t WHERE a = $1 AND b = $2',
        ['val1', 42],
      );
    });

    it('returns error when pool not initialized', async () => {
      pool = new ConnectionPool();

      const result = await pool.query('SELECT 1', []);

      expect(result.ok).toBe(false);
    });

    it('returns error when query fails', async () => {
      mockQuery.mockRejectedValue(new Error('Syntax error'));

      pool = new ConnectionPool();
      await pool.create(makePoolConfig());

      const result = await pool.query('INVALID SQL', []);

      expect(result.ok).toBe(false);
    });

    it('handles null rowCount', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 1 }],
        rowCount: null,
      });

      pool = new ConnectionPool();
      await pool.create(makePoolConfig());

      const result = await pool.query('SELECT 1', []);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.rowCount).toBe(0);
    });
  });

  describe('acquireClient', () => {
    it('acquires a client from the pool', async () => {
      const mockClient = { release: mockRelease, query: mockQuery };
      mockConnect.mockResolvedValue(mockClient);

      pool = new ConnectionPool();
      await pool.create(makePoolConfig());

      const result = await pool.acquireClient();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(mockClient);
    });

    it('returns error when pool not initialized', async () => {
      pool = new ConnectionPool();

      const result = await pool.acquireClient();

      expect(result.ok).toBe(false);
    });
  });

  describe('destroy', () => {
    it('drains and closes the pool', async () => {
      pool = new ConnectionPool();
      await pool.create(makePoolConfig());

      const result = await pool.destroy();

      expect(result.ok).toBe(true);
      expect(mockEnd).toHaveBeenCalledTimes(1);
      pool = null; // Already destroyed
    });

    it('succeeds when pool not initialized', async () => {
      pool = new ConnectionPool();

      const result = await pool.destroy();

      expect(result.ok).toBe(true);
      pool = null;
    });

    it('returns error when end fails', async () => {
      mockEnd.mockRejectedValue(new Error('End failed'));

      pool = new ConnectionPool();
      await pool.create(makePoolConfig());

      const result = await pool.destroy();

      expect(result.ok).toBe(false);
      pool = null;
    });
  });
});
