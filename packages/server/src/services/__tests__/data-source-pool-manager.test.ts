// ===========================================
// Data Source Pool Manager Tests
// ===========================================
// Read-only enforcement, row cap, pool reuse/rebuild, and invalidation — with a
// mocked ConnectionPool (no real database).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock ConnectionPool -----

interface MockState {
  rows: Record<string, unknown>[];
  created: number;
  destroyed: number;
  txStatements: string[];
  directStatements: string[];
  readOnlyStatements: string[];
}

const state: MockState = { rows: [], created: 0, destroyed: 0, txStatements: [], directStatements: [], readOnlyStatements: [] };

class MockConnectionPool {
  async create(): Promise<{ ok: true; value: void }> {
    state.created += 1;
    return { ok: true, value: undefined };
  }
  async transaction<T>(fn: (tx: { query: (sql: string, params: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }> }) => Promise<T>): Promise<{ ok: true; value: T }> {
    const tx = {
      query: async (sql: string) => {
        state.txStatements.push(sql);
        return { rows: state.rows, rowCount: state.rows.length };
      },
    };
    return { ok: true, value: await fn(tx) };
  }
  async queryReadOnly(sql: string): Promise<{ ok: true; value: { rows: Record<string, unknown>[]; rowCount: number } }> {
    state.readOnlyStatements.push(sql);
    return { ok: true, value: { rows: state.rows, rowCount: state.rows.length } };
  }
  async query(sql: string): Promise<{ ok: true; value: { rows: Record<string, unknown>[]; rowCount: number } }> {
    state.directStatements.push(sql);
    return { ok: true, value: { rows: state.rows, rowCount: state.rows.length } };
  }
  async destroy(): Promise<{ ok: true; value: void }> {
    state.destroyed += 1;
    return { ok: true, value: undefined };
  }
}

vi.mock('@mirthless/connectors', () => ({ ConnectionPool: MockConnectionPool }));

const { DataSourcePoolManager } = await import('../data-source-pool-manager.js');
type PooledDataSource = import('../data-source-pool-manager.js').PooledDataSource;

// ----- Fixtures -----

function makeSource(overrides?: Partial<PooledDataSource>): PooledDataSource {
  return {
    id: 'ds-1', host: 'db.internal', port: 5432, database: 'reports', user: 'ro', password: 'pw',
    readOnly: true, maxConnections: 5, statementTimeoutMs: 30_000, maxRows: 100, ...overrides,
  };
}

beforeEach(() => {
  state.rows = [];
  state.created = 0;
  state.destroyed = 0;
  state.txStatements = [];
  state.directStatements = [];
  state.readOnlyStatements = [];
});

// ----- Tests -----

describe('DataSourcePoolManager', () => {
  it('runs a read-only query through the single-statement read-only path', async () => {
    state.rows = [{ id: 1 }];
    const mgr = new DataSourcePoolManager();

    const rows = await mgr.runQuery(makeSource({ readOnly: true }), 'SELECT 1', []);

    expect(rows).toEqual([{ id: 1 }]);
    expect(state.readOnlyStatements).toEqual(['SELECT 1']);
    expect(state.directStatements).toHaveLength(0); // did not use the read-write path
  });

  it('runs a read-write query directly (no read-only transaction)', async () => {
    state.rows = [];
    const mgr = new DataSourcePoolManager();

    await mgr.runQuery(makeSource({ readOnly: false }), 'INSERT INTO t VALUES ($1)', [1]);

    expect(state.directStatements).toContain('INSERT INTO t VALUES ($1)');
    expect(state.readOnlyStatements).toHaveLength(0);
  });

  it('rejects a result set larger than maxRows', async () => {
    state.rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const mgr = new DataSourcePoolManager();

    await expect(mgr.runQuery(makeSource({ maxRows: 2 }), 'SELECT 1', [])).rejects.toThrow(/exceeding maxRows/);
  });

  it('reuses the pool across calls for an unchanged source', async () => {
    const mgr = new DataSourcePoolManager();
    const src = makeSource();

    await mgr.runQuery(src, 'SELECT 1', []);
    await mgr.runQuery(src, 'SELECT 2', []);

    expect(state.created).toBe(1);
  });

  it('rebuilds the pool when connection config changes', async () => {
    const mgr = new DataSourcePoolManager();

    await mgr.runQuery(makeSource({ host: 'a' }), 'SELECT 1', []);
    await mgr.runQuery(makeSource({ host: 'b' }), 'SELECT 1', []);

    expect(state.created).toBe(2);
    expect(state.destroyed).toBe(1); // old pool torn down
  });

  it('invalidate() destroys the cached pool', async () => {
    const mgr = new DataSourcePoolManager();
    await mgr.runQuery(makeSource(), 'SELECT 1', []);

    await mgr.invalidate('ds-1');

    expect(state.destroyed).toBe(1);
  });

  it('shutdown() destroys all pools', async () => {
    const mgr = new DataSourcePoolManager();
    await mgr.runQuery(makeSource({ id: 'a', host: 'a' }), 'SELECT 1', []);
    await mgr.runQuery(makeSource({ id: 'b', host: 'b' }), 'SELECT 1', []);

    await mgr.shutdown();

    expect(state.destroyed).toBe(2);
  });
});
