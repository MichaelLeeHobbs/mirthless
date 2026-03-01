// ===========================================
// Database Receiver Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseReceiver, UPDATE_MODE, ROW_FORMAT, type DatabaseReceiverConfig } from '../database-receiver.js';
import { ConnectionPool } from '../connection-pool.js';
import type { RawMessage, DispatchResult } from '../../base.js';
import type { Result } from '@mirthless/core-util';

// ----- Helpers -----

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
    error: { name: 'Error', code: 'DISPATCH_FAILED', message: 'dispatch failed' },
  });
}

function makeMockPool(): {
  pool: ConnectionPool;
  createFn: ReturnType<typeof vi.fn>;
  queryFn: ReturnType<typeof vi.fn>;
  destroyFn: ReturnType<typeof vi.fn>;
} {
  const createFn = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });
  const queryFn = vi.fn().mockResolvedValue({
    ok: true,
    value: { rows: [], rowCount: 0 },
    error: null,
  });
  const destroyFn = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });

  const pool = {
    create: createFn,
    query: queryFn,
    destroy: destroyFn,
    acquireClient: vi.fn(),
  } as unknown as ConnectionPool;

  return { pool, createFn, queryFn, destroyFn };
}

// ----- Lifecycle -----

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

// ----- Tests -----

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

      // Only the SELECT query should be called, not any UPDATE
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

      // SELECT + UPDATE
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

      // SELECT + UPDATE (dispatch succeeded)
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

      // Only SELECT, no UPDATE since dispatch failed
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

      // SELECT + UPDATE (ALWAYS mode ignores dispatch result)
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
});
