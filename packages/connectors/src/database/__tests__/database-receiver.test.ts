import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseReceiver, UPDATE_MODE, ROW_FORMAT, type DatabaseReceiverConfig } from '../database-receiver.js';
import { ConnectionPool } from '../connection-pool.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';
import type { RawMessage, DispatchResult } from '../../base.js';
import { stderr, type Result } from '@galvanigraph/core-util';

function makeConfig(overrides?: Partial<DatabaseReceiverConfig>): DatabaseReceiverConfig {
  return {
    host: 'localhost',
    port: 5432,
    database: 'testdb',
    username: 'testuser',
    password: 'testpass',
    selectQuery: 'SELECT * FROM messages WHERE processed = false',
    updateQuery: '',
    updateMode: UPDATE_MODE.NEVER,
    pollingIntervalMs: 5_000,
    rowFormat: ROW_FORMAT.JSON,
    ...overrides,
  };
}

function makeDispatcher(
  handler?: (raw: RawMessage) => DispatchResult,
): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async (raw) => ({
    ok: true as const,
    value: handler
      ? handler(raw)
      : { messageId: 1 },
    error: null,
  });
}

function makeFailDispatcher(): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async () => ({
    ok: false as const,
    value: null,
    error: stderr({ name: 'Error', code: 'DISPATCH_FAILED', message: 'dispatch failed' }),
  });
}

function makeMockPool(): {
  pool: ConnectionPool;
  createFn: ReturnType<typeof vi.fn>;
  queryFn: ReturnType<typeof vi.fn>;
  destroyFn: ReturnType<typeof vi.fn>;
  transactionFn: ReturnType<typeof vi.fn>;
} {
  const createFn = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });
  const queryFn = vi.fn().mockResolvedValue({
    ok: true,
    value: { rows: [], rowCount: 0 },
    error: null,
  });
  const destroyFn = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });

  // A queryFn error is thrown, as the real TxQuery does, rolling back the tx.
  const transactionFn = vi.fn().mockImplementation(async (fn: (tx: { query: (sql: string, params: readonly unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
    try {
      const value = await fn({
        query: async (sql, params) => {
          // Savepoint bookkeeping is not a query the tests count.
          if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) /.test(sql)) return { rows: [], rowCount: 0 };
          const r = await queryFn(sql, params);
          if (!r.ok) throw r.error;
          return r.value;
        },
      });
      return { ok: true, value, error: null };
    } catch (error) {
      return { ok: false, value: null, error };
    }
  });

  const pool = {
    create: createFn,
    query: queryFn,
    destroy: destroyFn,
    acquireClient: vi.fn(),
    transaction: transactionFn,
  } as unknown as ConnectionPool;

  return { pool, createFn, queryFn, destroyFn, transactionFn };
}

let receiver: DatabaseReceiver | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  if (receiver) {
    await receiver.onStop();
    await receiver.onUndeploy();
    receiver = null;
  }
});

describe('DatabaseReceiver', () => {
  describe('onDeploy', () => {
    it('validates host is required', async () => {
      receiver = new DatabaseReceiver(makeConfig({ host: '' }));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates database name is required', async () => {
      receiver = new DatabaseReceiver(makeConfig({ database: '' }));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates selectQuery is required', async () => {
      receiver = new DatabaseReceiver(makeConfig({ selectQuery: '' }));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates polling interval minimum', async () => {
      receiver = new DatabaseReceiver(makeConfig({ pollingIntervalMs: 50 }));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates updateQuery required when updateMode is not NEVER', async () => {
      receiver = new DatabaseReceiver(makeConfig({
        updateMode: UPDATE_MODE.ALWAYS,
        updateQuery: '',
      }));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('deploys with valid config', async () => {
      receiver = new DatabaseReceiver(makeConfig());
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(true);
    });

    it('deploys with updateMode ON_SUCCESS and updateQuery', async () => {
      receiver = new DatabaseReceiver(makeConfig({
        updateMode: UPDATE_MODE.ON_SUCCESS,
        updateQuery: 'UPDATE messages SET processed = true WHERE id = ${id}',
      }));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(true);
    });
  });

  describe('onStart', () => {
    it('errors if dispatcher not set', async () => {
      const { pool } = makeMockPool();
      receiver = new DatabaseReceiver(makeConfig(), pool);
      const result = await receiver.onStart();
      expect(result.ok).toBe(false);
    });

    it('creates pool and starts polling', async () => {
      const { pool, createFn } = makeMockPool();
      receiver = new DatabaseReceiver(makeConfig(), pool);
      receiver.setDispatcher(makeDispatcher());

      const result = await receiver.onStart();

      expect(result.ok).toBe(true);
      expect(createFn).toHaveBeenCalledTimes(1);
    });

    it('opens the pool with a 30s statement timeout and TLS off unless tls is true', async () => {
      const { pool, createFn } = makeMockPool();
      receiver = new DatabaseReceiver(makeConfig(), pool);
      receiver.setDispatcher(makeDispatcher());

      await receiver.onStart();

      expect(createFn.mock.calls[0]![0]).toStrictEqual({
        host: 'localhost', port: 5432, database: 'testdb', user: 'testuser', password: 'testpass',
        maxConnections: 5, idleTimeoutMs: 30_000, connectionTimeoutMs: 10_000, tls: false, statementTimeoutMs: 30_000,
      });
    });

    it('opens the pool with TLS when tls is true', async () => {
      const { pool, createFn } = makeMockPool();
      receiver = new DatabaseReceiver(makeConfig({ tls: true }), pool);
      receiver.setDispatcher(makeDispatcher());

      await receiver.onStart();

      expect(createFn.mock.calls[0]![0]).toMatchObject({ tls: true, statementTimeoutMs: 30_000 });
    });

    it('fails if pool creation fails', async () => {
      const { pool, createFn } = makeMockPool();
      createFn.mockResolvedValue({
        ok: false,
        value: null,
        error: { name: 'Error', code: 'CONNECT_FAILED', message: 'Connection refused' },
      });

      receiver = new DatabaseReceiver(makeConfig(), pool);
      receiver.setDispatcher(makeDispatcher());

      const result = await receiver.onStart();

      expect(result.ok).toBe(false);
      receiver = null; // Don't try to stop since start failed
    });
  });

  describe('poll cycle', () => {
    it('dispatches each row as a JSON message', async () => {
      const captured: RawMessage[] = [];
      const { pool, queryFn } = makeMockPool();

      queryFn.mockResolvedValue({
        ok: true,
        value: {
          rows: [
            { id: 1, name: 'patient1' },
            { id: 2, name: 'patient2' },
          ],
          rowCount: 2,
        },
        error: null,
      });

      receiver = new DatabaseReceiver(makeConfig(), pool);
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: captured.length };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(captured).toHaveLength(2);
      expect(JSON.parse(captured[0]!.content)).toEqual({ id: 1, name: 'patient1' });
      expect(JSON.parse(captured[1]!.content)).toEqual({ id: 2, name: 'patient2' });
    });

    it('includes database metadata in sourceMap', async () => {
      let capturedRaw: RawMessage | null = null;
      const { pool, queryFn } = makeMockPool();

      queryFn.mockResolvedValue({
        ok: true,
        value: { rows: [{ id: 1 }], rowCount: 1 },
        error: null,
      });

      receiver = new DatabaseReceiver(makeConfig(), pool);
      receiver.setDispatcher(makeDispatcher((raw) => {
        capturedRaw = raw;
        return { messageId: 1 };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(capturedRaw).not.toBeNull();
      expect(capturedRaw!.sourceMap['database']).toBe('testdb');
      expect(capturedRaw!.sourceMap['host']).toBe('localhost');
      expect(capturedRaw!.sourceMap['port']).toBe(5432);
    });

    it('handles empty result set', async () => {
      const captured: RawMessage[] = [];
      const { pool } = makeMockPool();

      receiver = new DatabaseReceiver(makeConfig(), pool);
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: 1 };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(captured).toHaveLength(0);
    });

    it('skips poll when query fails', async () => {
      const captured: RawMessage[] = [];
      const { pool, queryFn } = makeMockPool();

      queryFn.mockResolvedValue({
        ok: false,
        value: null,
        error: { name: 'Error', code: 'QUERY_FAILED', message: 'query error' },
      });

      receiver = new DatabaseReceiver(makeConfig(), pool);
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: 1 };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(captured).toHaveLength(0);
    });
  });

  describe('update modes', () => {
    it('does not execute update when updateMode is NEVER', async () => {
      const { pool, queryFn } = makeMockPool();

      queryFn.mockResolvedValue({
        ok: true,
        value: { rows: [{ id: 1 }], rowCount: 1 },
        error: null,
      });

      receiver = new DatabaseReceiver(makeConfig({
        updateMode: UPDATE_MODE.NEVER,
      }), pool);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('executes update when updateMode is ALWAYS', async () => {
      const { pool, queryFn } = makeMockPool();

      queryFn.mockResolvedValue({
        ok: true,
        value: { rows: [{ id: 1 }], rowCount: 1 },
        error: null,
      });

      receiver = new DatabaseReceiver(makeConfig({
        updateMode: UPDATE_MODE.ALWAYS,
        updateQuery: 'UPDATE messages SET processed = true WHERE id = ${id}',
      }), pool);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(queryFn).toHaveBeenCalledTimes(2);
      expect(queryFn.mock.calls[1]![0]).toBe(
        'UPDATE messages SET processed = true WHERE id = $1',
      );
      expect(queryFn.mock.calls[1]![1]).toEqual([1]);
    });

    it('executes update on success only when updateMode is ON_SUCCESS', async () => {
      const { pool, queryFn } = makeMockPool();

      queryFn.mockResolvedValue({
        ok: true,
        value: { rows: [{ id: 1 }], rowCount: 1 },
        error: null,
      });

      receiver = new DatabaseReceiver(makeConfig({
        updateMode: UPDATE_MODE.ON_SUCCESS,
        updateQuery: 'UPDATE messages SET processed = true WHERE id = ${id}',
      }), pool);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(queryFn).toHaveBeenCalledTimes(2);
    });

    it('skips update on dispatch failure when updateMode is ON_SUCCESS', async () => {
      const { pool, queryFn } = makeMockPool();

      queryFn.mockResolvedValue({
        ok: true,
        value: { rows: [{ id: 1 }], rowCount: 1 },
        error: null,
      });

      receiver = new DatabaseReceiver(makeConfig({
        updateMode: UPDATE_MODE.ON_SUCCESS,
        updateQuery: 'UPDATE messages SET processed = true WHERE id = ${id}',
      }), pool);
      receiver.setDispatcher(makeFailDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('executes update even on failure when updateMode is ALWAYS', async () => {
      const { pool, queryFn } = makeMockPool();

      queryFn.mockResolvedValue({
        ok: true,
        value: { rows: [{ id: 1 }], rowCount: 1 },
        error: null,
      });

      receiver = new DatabaseReceiver(makeConfig({
        updateMode: UPDATE_MODE.ALWAYS,
        updateQuery: 'UPDATE messages SET processed = true WHERE id = ${id}',
      }), pool);
      receiver.setDispatcher(makeFailDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(queryFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('lifecycle', () => {
    it('stops and destroys pool', async () => {
      const { pool, destroyFn } = makeMockPool();

      receiver = new DatabaseReceiver(makeConfig(), pool);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      const stopResult = await receiver.onStop();
      expect(stopResult.ok).toBe(true);
      expect(destroyFn).toHaveBeenCalledTimes(1);

      receiver = null;
    });

    it('halt destroys pool', async () => {
      const { pool, destroyFn } = makeMockPool();

      receiver = new DatabaseReceiver(makeConfig(), pool);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      const haltResult = await receiver.onHalt();
      expect(haltResult.ok).toBe(true);
      expect(destroyFn).toHaveBeenCalledTimes(1);

      receiver = null;
    });

    it('undeploy clears dispatcher', async () => {
      const { pool } = makeMockPool();

      receiver = new DatabaseReceiver(makeConfig(), pool);
      receiver.setDispatcher(makeDispatcher());

      const result = await receiver.onUndeploy();
      expect(result.ok).toBe(true);

      receiver = null;
    });
  });

  describe('atomic claim (no double-processing)', () => {
    it('issues the SELECT with a row lock in claim mode', async () => {
      const { pool, queryFn, transactionFn } = makeMockPool();
      queryFn.mockResolvedValue({ ok: true, value: { rows: [{ id: 1 }], rowCount: 1 }, error: null });

      receiver = new DatabaseReceiver(makeConfig({
        updateMode: UPDATE_MODE.ON_SUCCESS,
        updateQuery: 'UPDATE t SET processed = true WHERE id = ${id}',
      }), pool);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(transactionFn).toHaveBeenCalled();
      const selectSql = queryFn.mock.calls[0]![0] as string;
      expect(selectSql).toContain('FOR UPDATE SKIP LOCKED');
    });

    // Regression: on MySQL a deadlock rolls back the whole transaction, savepoint
    // included, so ROLLBACK TO SAVEPOINT fails too. The acks of rows already
    // dispatched were lost and those rows were dispatched again next poll.
    it('acks rows a failed poll already dispatched without dispatching them again', async () => {
      const processed = new Set<number>();
      let deadlocked = false;
      const pool = {
        create: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        destroy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        query: vi.fn(),
        transaction: vi.fn().mockImplementation(async (fn: (tx: { query: (sql: string, params: readonly unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
          const writes = new Set<number>();
          let rolledBack = false;
          const tx = {
            query: async (sql: string, params: readonly unknown[]) => {
              if (/for update skip locked/i.test(sql)) {
                const rows = [1, 2, 3].filter((id) => !processed.has(id)).map((id) => ({ id }));
                return { rows, rowCount: rows.length };
              }
              if (sql.startsWith('SAVEPOINT') || sql.startsWith('RELEASE')) return { rows: [], rowCount: 0 };
              if (sql.startsWith('ROLLBACK TO')) {
                if (rolledBack) throw new Error('SAVEPOINT ack_row does not exist');
                return { rows: [], rowCount: 0 };
              }
              const id = params[0] as number;
              if (id === 2 && !deadlocked) {
                deadlocked = true;
                rolledBack = true;
                throw Object.assign(new Error('Deadlock found when trying to get lock'), { errno: 1213 });
              }
              writes.add(id);
              return { rows: [], rowCount: 1 };
            },
          };
          try {
            const value = await fn(tx);
            for (const id of writes) processed.add(id);
            return { ok: true, value, error: null };
          } catch (error) {
            return { ok: false, value: null, error };
          }
        }),
      } as unknown as ConnectionPool;
      const dispatched: number[] = [];
      receiver = new DatabaseReceiver(makeConfig({
        updateMode: UPDATE_MODE.ALWAYS,
        updateQuery: 'UPDATE t SET processed = true WHERE id = ${id}',
      }), pool);
      receiver.setDispatcher(makeDispatcher((raw) => {
        const id = (JSON.parse(raw.content) as { id: number }).id;
        dispatched.push(id);
        return { messageId: id };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(dispatched).toEqual([1, 2]);
      expect([...processed].sort()).toEqual([1, 2]);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(dispatched).toEqual([1, 2, 3]);
    });

    it('two concurrent pollers over a locking table dispatch each row exactly once', async () => {
      const table = [1, 2, 3].map((id) => ({ id, processed: false, locked: false }));
      const dispatched: number[] = [];

      const sharedPool = {
        create: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        destroy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        query: vi.fn(),
        acquireClient: vi.fn(),
        transaction: vi.fn().mockImplementation(async (fn: (tx: { query: (sql: string, params: readonly unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
          const claimed: typeof table = [];
          const tx = {
            query: async (sql: string, params: readonly unknown[]) => {
              if (/for update skip locked/i.test(sql)) {
                const avail = table.filter((r) => !r.processed && !r.locked);
                for (const r of avail) { r.locked = true; claimed.push(r); }
                return { rows: avail.map((r) => ({ id: r.id })), rowCount: avail.length };
              }
              const id = params[0];
              const row = table.find((r) => r.id === id);
              if (row) row.processed = true;
              return { rows: [], rowCount: 1 };
            },
          };
          try {
            const value = await fn(tx);
            for (const r of claimed) r.locked = false;
            return { ok: true, value, error: null };
          } catch (error) {
            for (const r of claimed) r.locked = false;
            return { ok: false, value: null, error };
          }
        }),
      } as unknown as ConnectionPool;

      const cfg = makeConfig({
        updateMode: UPDATE_MODE.ON_SUCCESS,
        updateQuery: 'UPDATE t SET processed = true WHERE id = ${id}',
      });
      const dispatcher = makeDispatcher((raw) => {
        const id = (JSON.parse(raw.content) as { id: number }).id;
        dispatched.push(id);
        return { messageId: id };
      });

      const a = new DatabaseReceiver(cfg, sharedPool);
      const b = new DatabaseReceiver(cfg, sharedPool);
      a.setDispatcher(dispatcher);
      b.setDispatcher(dispatcher);
      await a.onStart();
      await b.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect([...dispatched].sort()).toEqual([1, 2, 3]);
      expect(new Set(dispatched).size).toBe(dispatched.length);
      expect(table.every((r) => r.processed)).toBe(true);

      await a.onStop();
      await b.onStop();
    });
  });

  describe('failure visibility', () => {
    it('logs an error when the SELECT query fails (e.g. expired creds)', async () => {
      const { pool, queryFn } = makeMockPool();
      queryFn.mockResolvedValue({ ok: false, value: null, error: { name: 'Error', code: 'ECONNREFUSED', message: 'connection refused' } });
      const { logger, errors } = makeMockLogger();

      receiver = new DatabaseReceiver(makeConfig(), pool, logger);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(errors.some((e) => e.msg.includes('SELECT failed'))).toBe(true);
    });

    it('logs an error when a mark-as-processed UPDATE fails', async () => {
      const { pool, queryFn } = makeMockPool();
      queryFn
        .mockResolvedValueOnce({ ok: true, value: { rows: [{ id: 1 }], rowCount: 1 }, error: null })
        .mockResolvedValueOnce({ ok: false, value: null, error: { name: 'Error', code: 'X', message: 'update failed' } });
      const { logger, errors } = makeMockLogger();

      receiver = new DatabaseReceiver(
        makeConfig({ updateMode: UPDATE_MODE.ALWAYS, updateQuery: 'UPDATE messages SET processed = true WHERE id = :id' }),
        pool,
        logger,
      );
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(errors.some((e) => e.msg.includes('UPDATE failed'))).toBe(true);
    });
  });
});

describe('DatabaseReceiver when the pipeline recorded an error', () => {
  it('marks the row processed under ON_SUCCESS, so it is not read and recorded again every poll', async () => {
    const { pool, queryFn } = makeMockPool();
    queryFn.mockResolvedValue({ ok: true, value: { rows: [{ id: 1 }], rowCount: 1 }, error: null });

    receiver = new DatabaseReceiver(makeConfig({
      updateMode: UPDATE_MODE.ON_SUCCESS,
      updateQuery: 'UPDATE messages SET processed = true WHERE id = ${id}',
    }), pool);
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 4, status: 'ERROR' })));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    const statements = queryFn.mock.calls.map((c) => String(c[0]));
    expect(statements.some((sql) => sql.startsWith('UPDATE messages SET processed = true'))).toBe(true);
  });

  it('leaves the row for the next poll under ON_SUCCESS when the pipeline could not take the message', async () => {
    const { pool, queryFn } = makeMockPool();
    queryFn.mockResolvedValue({ ok: true, value: { rows: [{ id: 1 }], rowCount: 1 }, error: null });

    receiver = new DatabaseReceiver(makeConfig({
      updateMode: UPDATE_MODE.ON_SUCCESS,
      updateQuery: 'UPDATE messages SET processed = true WHERE id = ${id}',
    }), pool);
    receiver.setDispatcher(async () => ({ ok: false as const, value: null, error: new Error('store down') }) as never);
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    const statements = queryFn.mock.calls.map((c) => String(c[0]));
    expect(statements.some((sql) => sql.startsWith('UPDATE'))).toBe(false);
  });

  it('marks a filtered row processed under ON_SUCCESS', async () => {
    const { pool, queryFn } = makeMockPool();
    queryFn.mockResolvedValue({ ok: true, value: { rows: [{ id: 1 }], rowCount: 1 }, error: null });

    receiver = new DatabaseReceiver(makeConfig({
      updateMode: UPDATE_MODE.ON_SUCCESS,
      updateQuery: 'UPDATE messages SET processed = true WHERE id = ${id}',
    }), pool);
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 4, status: 'FILTERED' })));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(queryFn).toHaveBeenCalledTimes(2);
  });
});

describe('DatabaseReceiver row limit', () => {
  it('dispatches at most 1,000 rows in one poll and says the query needs a LIMIT', async () => {
    vi.useFakeTimers();
    try {
      const { pool, queryFn } = makeMockPool();
      const rows = Array.from({ length: 1_001 }, (_, i) => ({ id: i + 1 }));
      queryFn.mockResolvedValueOnce({ ok: true, value: { rows, rowCount: rows.length }, error: null });
      const warn = vi.fn();
      const dispatched: string[] = [];
      const receiver = new DatabaseReceiver(makeConfig(), pool, { error: vi.fn(), warn, info: vi.fn(), debug: vi.fn() });
      receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(raw.content); return { messageId: 1 }; }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);
      await receiver.onStop();

      expect(dispatched).toHaveLength(1_000);
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ rows: 1_001, limit: 1_000 }), expect.stringContaining('add a LIMIT'));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DatabaseReceiver when a row cannot be marked', () => {
  /** A table behind a pool: `held` ids are locked by others, `fails` says which ids the mark statement refuses, `broken` fails whole transactions at COMMIT. */
  function makeTable(rows: Array<Record<string, unknown>>): {
    readonly pool: ConnectionPool; rows: Array<Record<string, unknown>>; readonly held: Set<unknown>; readOnlyFails: boolean; readonly fails: Set<unknown>; broken: boolean;
  } {
    const table = {
      rows,
      held: new Set<unknown>(),
      readOnlyFails: false,
      fails: new Set<unknown>(),
      broken: false,
      pool: {
        create: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        destroy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
        query: vi.fn(),
        queryReadOnly: async (sql: string) => {
          if (table.readOnlyFails) return { ok: false, value: null, error: new Error('cannot execute UPDATE in a read-only transaction') };
          expect(sql).not.toContain('FOR UPDATE');
          return { ok: true, value: { rows: [...table.rows], rowCount: table.rows.length }, error: null };
        },
        transaction: async (fn: (tx: { query: (sql: string, params: readonly unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
          const marks: unknown[] = [];
          try {
            const value = await fn({
              query: async (sql, params) => {
                if (sql.startsWith('SELECT')) {
                  const free = table.rows.filter((row) => !table.held.has(row['id']));
                  return { rows: free, rowCount: free.length };
                }
                if (!sql.startsWith('UPDATE')) return { rows: [], rowCount: 0 };
                if (table.fails.has(params[0])) throw new Error('constraint');
                marks.push(params[0]);
                return { rows: [], rowCount: 1 };
              },
            });
            if (table.broken) throw new Error('Connection lost');
            table.rows = table.rows.filter((row) => !marks.includes(row['id']));
            return { ok: true, value, error: null };
          } catch (error) {
            return { ok: false, value: null, error };
          }
        },
      } as unknown as ConnectionPool,
    };
    return table;
  }

  async function run(pool: ConnectionPool, updateMode: DatabaseReceiverConfig['updateMode'] = UPDATE_MODE.ON_SUCCESS): Promise<Array<Record<string, unknown>>> {
    const dispatched: Array<Record<string, unknown>> = [];
    receiver = new DatabaseReceiver(makeConfig({ updateMode, updateQuery: 'UPDATE t SET done = true WHERE id = ${id}' }), pool, makeMockLogger().logger);
    receiver.setDispatcher(makeDispatcher((raw) => {
      dispatched.push(JSON.parse(raw.content) as Record<string, unknown>);
      return { messageId: dispatched.length };
    }));
    await receiver.onStart();
    return dispatched;
  }

  const poll = async (): Promise<unknown> => vi.advanceTimersByTimeAsync(5_000);

  it.each([UPDATE_MODE.ON_SUCCESS, UPDATE_MODE.ALWAYS])('dispatches it once and marks it once it can (%s)', async (mode) => {
    const table = makeTable([{ id: 1 }, { id: 2 }]);
    table.fails.add(1);
    const dispatched = await run(table.pool, mode);

    await poll();
    await poll();
    await poll();
    expect(dispatched).toEqual([{ id: 1 }, { id: 2 }]);
    expect(table.rows).toEqual([{ id: 1 }]);

    table.fails.clear();
    await poll();
    expect(dispatched).toHaveLength(2);
    expect(table.rows).toEqual([]);
  });

  it('dispatches it again when it changed, or when it was gone in between', async () => {
    const table = makeTable([{ id: 1, v: 'a' }]);
    table.fails.add(1);
    const dispatched = await run(table.pool);
    await poll();

    table.rows = [{ id: 1, v: 'b' }];
    await poll();
    table.rows = [];
    await poll();
    table.rows = [{ id: 1, v: 'b' }];
    await poll();

    expect(dispatched).toEqual([{ id: 1, v: 'a' }, { id: 1, v: 'b' }, { id: 1, v: 'b' }]);
  });

  it('does not dispatch it again after a poll that skipped it because another transaction held it', async () => {
    const table = makeTable([{ id: 1 }]);
    table.fails.add(1);
    const dispatched = await run(table.pool);
    await poll();
    table.held.add(1);
    await poll();
    table.held.clear();
    await poll();
    table.fails.clear();
    await poll();

    expect(dispatched).toEqual([{ id: 1 }]);
    expect(table.rows).toEqual([]);
  });

  it('counts it as gone when the query is one that cannot be read again without writing', async () => {
    const table = makeTable([{ id: 1 }]);
    table.fails.add(1);
    table.readOnlyFails = true;
    const dispatched = await run(table.pool);
    await poll();
    table.held.add(1);
    await poll();
    table.held.clear();
    await poll();

    expect(dispatched).toHaveLength(2);
  });

  it('dispatches another row that reads the same', async () => {
    const table = makeTable([{ id: 1 }]);
    table.fails.add(1);
    const dispatched = await run(table.pool);
    await poll();

    table.rows = [{ id: 1 }, { id: 1 }];
    await poll();
    await poll();

    expect(dispatched).toEqual([{ id: 1 }, { id: 1 }]);
  });

  it('marks and does not dispatch the rows of a poll whose transaction, and the one after it, failed', async () => {
    const table = makeTable([{ id: 1 }, { id: 2 }]);
    table.broken = true;
    const dispatched = await run(table.pool);
    await poll();
    await poll();
    expect(dispatched).toEqual([{ id: 1 }, { id: 2 }]);

    table.broken = false;
    await poll();
    expect(dispatched).toHaveLength(2);
    expect(table.rows).toEqual([]);
  });

  it('dispatches a row the pipeline did not take at every poll', async () => {
    const table = makeTable([{ id: 1 }]);
    table.fails.add(1);
    let offers = 0;
    receiver = new DatabaseReceiver(makeConfig({ updateMode: UPDATE_MODE.ALWAYS, updateQuery: 'UPDATE t SET done = true WHERE id = ${id}' }), table.pool, makeMockLogger().logger);
    receiver.setDispatcher(async (raw) => { offers += 1; return makeFailDispatcher()(raw); });
    await receiver.onStart();
    await poll();
    await poll();
    expect(offers).toBe(2);
  });
});

describe('DatabaseReceiver stopped in mid-poll', () => {
  function makeBlockedSource(updateMode: DatabaseReceiverConfig['updateMode']): {
    readonly source: DatabaseReceiver; readonly destroyFn: ReturnType<typeof vi.fn>; readonly marked: () => unknown[]; readonly dispatched: string[]; readonly release: () => void;
  } {
    const { pool, queryFn, destroyFn } = makeMockPool();
    queryFn.mockResolvedValue({ ok: true, value: { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 }, error: null });
    const dispatched: string[] = [];
    let release = (): void => {};
    const source = new DatabaseReceiver(makeConfig({ updateMode, updateQuery: 'UPDATE t SET done = true WHERE id = ${id}' }), pool, makeMockLogger().logger);
    source.setDispatcher(async (raw) => {
      dispatched.push(raw.content);
      await new Promise<void>((resolve) => { release = resolve; });
      return { ok: true, value: { messageId: 1 }, error: null };
    });
    const marked = (): unknown[] => queryFn.mock.calls.filter((call) => String(call[0]).startsWith('UPDATE')).map((call) => (call[1] as unknown[])[0]);
    return { source, destroyFn, marked, dispatched, release: () => { release(); } };
  }

  it.each([UPDATE_MODE.NEVER, UPDATE_MODE.ALWAYS, UPDATE_MODE.ON_SUCCESS])('a stop waits for the row in hand and takes no more (%s)', async (mode) => {
    const { source, destroyFn, marked, dispatched, release } = makeBlockedSource(mode);
    await source.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    const stopped = source.onStop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(destroyFn).not.toHaveBeenCalled();
    release();
    await stopped;

    expect(dispatched).toEqual(['{"id":1}']);
    expect(marked()).toEqual(mode === UPDATE_MODE.NEVER ? [] : [1]);
    expect(destroyFn).toHaveBeenCalledTimes(1);
  });

  it('a halt does not wait, and the cycle marks its row, marks no row it did not dispatch, and closes its pool', async () => {
    const { source, destroyFn, marked, dispatched, release } = makeBlockedSource(UPDATE_MODE.ALWAYS);
    await source.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    await source.onHalt();
    await source.onUndeploy();
    expect(destroyFn).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(dispatched).toEqual(['{"id":1}']);
    expect(marked()).toEqual([1]);
    expect(destroyFn).toHaveBeenCalledTimes(1);
  });

  it('a start after a halt polls once the cycle in flight has ended', async () => {
    const { source, dispatched, release } = makeBlockedSource(UPDATE_MODE.ON_SUCCESS);
    await source.onStart();
    await vi.advanceTimersByTimeAsync(5_000);
    await source.onHalt();
    await source.onStart();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(dispatched).toHaveLength(1);

    release();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(dispatched).toHaveLength(2);
    const stopped = source.onStop();
    release();
    await stopped;
  });
});
