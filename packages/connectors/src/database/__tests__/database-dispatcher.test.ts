// ===========================================
// Database Dispatcher Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseDispatcher, type DatabaseDispatcherConfig } from '../database-dispatcher.js';
import type { DatabasePool, TxQuery } from '../connection-pool.js';
import { DATABASE_VENDOR } from '../database-vendor.js';
import type { ConnectorMessage } from '../../base.js';

// ----- Helpers -----

function makeConfig(overrides?: Partial<DatabaseDispatcherConfig>): DatabaseDispatcherConfig {
  return {
    host: 'localhost',
    port: 5432,
    database: 'testdb',
    username: 'testuser',
    password: 'testpass',
    query: 'INSERT INTO messages (content, channel_id) VALUES (${content}, ${channelId})',
    useTransaction: false,
    returnGeneratedKeys: false,
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<ConnectorMessage>): ConnectorMessage {
  return {
    channelId: '00000000-0000-0000-0000-000000000001',
    messageId: 42,
    metaDataId: 1,
    content: '{"name":"patient1","id":1}',
    dataType: 'JSON',
    ...overrides,
  };
}

function makeMockPool(): {
  pool: DatabasePool;
  createFn: ReturnType<typeof vi.fn>;
  queryFn: ReturnType<typeof vi.fn>;
  destroyFn: ReturnType<typeof vi.fn>;
  transactionFn: ReturnType<typeof vi.fn>;
  txQueryFn: ReturnType<typeof vi.fn>;
} {
  const createFn = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });
  const queryFn = vi.fn().mockResolvedValue({
    ok: true,
    value: { rows: [], rowCount: 1 },
    error: null,
  });
  const destroyFn = vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null });
  // The transaction runs the callback against txQueryFn, failing as a real pool
  // does (an error Result) when the callback throws.
  const txQueryFn = vi.fn().mockResolvedValue({ rows: [{ id: 7 }], rowCount: 1 });
  const transactionFn = vi.fn().mockImplementation(async (fn: (tx: TxQuery) => Promise<unknown>) => {
    try {
      return { ok: true, value: await fn({ query: txQueryFn }), error: null };
    } catch (error) {
      return { ok: false, value: null, error };
    }
  });

  const pool: DatabasePool = {
    create: createFn,
    query: queryFn,
    destroy: destroyFn,
    transaction: transactionFn,
  } as unknown as DatabasePool;

  return { pool, createFn, queryFn, destroyFn, transactionFn, txQueryFn };
}

// ----- Lifecycle -----

let dispatcher: DatabaseDispatcher | null = null;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  if (dispatcher) {
    await dispatcher.onStop();
    await dispatcher.onUndeploy();
    dispatcher = null;
  }
});

// ----- Tests -----

describe('DatabaseDispatcher', () => {
  describe('onDeploy', () => {
    it('validates host is required', async () => {
      const { pool } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig({ host: '' }), pool);
      const result = await dispatcher.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates database name is required', async () => {
      const { pool } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig({ database: '' }), pool);
      const result = await dispatcher.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates query is required', async () => {
      const { pool } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig({ query: '' }), pool);
      const result = await dispatcher.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('deploys with valid config', async () => {
      const { pool } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig(), pool);
      const result = await dispatcher.onDeploy();
      expect(result.ok).toBe(true);
    });
  });

  describe('onStart', () => {
    it('creates pool on start', async () => {
      const { pool, createFn } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig(), pool);
      const result = await dispatcher.onStart();

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

      dispatcher = new DatabaseDispatcher(makeConfig(), pool);
      const result = await dispatcher.onStart();

      expect(result.ok).toBe(false);
      dispatcher = null;
    });
  });

  describe('send (direct mode)', () => {
    it('errors when not started', async () => {
      const { pool } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig(), pool);

      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(false);
    });

    it('errors when signal is already aborted', async () => {
      const { pool } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig(), pool);
      await dispatcher.onStart();

      const controller = new AbortController();
      controller.abort();

      const result = await dispatcher.send(makeMessage(), controller.signal);

      expect(result.ok).toBe(false);
    });

    it('executes parameterized query', async () => {
      const { pool, queryFn } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig(), pool);
      await dispatcher.onStart();

      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(true);
      expect(queryFn).toHaveBeenCalledTimes(1);

      const [sql, params] = queryFn.mock.calls[0]!;
      expect(sql).toBe('INSERT INTO messages (content, channel_id) VALUES ($1, $2)');
      // content comes from the parsed JSON, channelId from the ConnectorMessage
      expect(params).toEqual(['{"name":"patient1","id":1}', '00000000-0000-0000-0000-000000000001']);
    });

    it('returns rowCount as content when returnGeneratedKeys is false', async () => {
      const { pool, queryFn } = makeMockPool();
      queryFn.mockResolvedValue({
        ok: true,
        value: { rows: [], rowCount: 1 },
        error: null,
      });

      dispatcher = new DatabaseDispatcher(makeConfig(), pool);
      await dispatcher.onStart();

      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe('SENT');
      expect(result.value.content).toBe('1');
    });

    it('returns rows as JSON when returnGeneratedKeys is true', async () => {
      const { pool, queryFn } = makeMockPool();
      queryFn.mockResolvedValue({
        ok: true,
        value: { rows: [{ id: 99 }], rowCount: 1 },
        error: null,
      });

      dispatcher = new DatabaseDispatcher(makeConfig({
        returnGeneratedKeys: true,
      }), pool);
      await dispatcher.onStart();

      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe('SENT');
      expect(JSON.parse(result.value.content)).toEqual([{ id: 99 }]);
    });

    it('returns error when query fails', async () => {
      const { pool, queryFn } = makeMockPool();
      queryFn.mockResolvedValue({
        ok: false,
        value: null,
        error: { name: 'Error', code: 'QUERY_FAILED', message: 'constraint violation' },
      });

      dispatcher = new DatabaseDispatcher(makeConfig(), pool);
      await dispatcher.onStart();

      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(false);
    });

    it('parses JSON content for template substitution', async () => {
      const { pool, queryFn } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig({
        query: 'INSERT INTO patients (name, patient_id) VALUES (${name}, ${id})',
      }), pool);
      await dispatcher.onStart();

      const result = await dispatcher.send(
        makeMessage({ content: '{"name":"John","id":123}' }),
        AbortSignal.timeout(5_000),
      );

      expect(result.ok).toBe(true);
      const [sql, params] = queryFn.mock.calls[0]!;
      expect(sql).toBe('INSERT INTO patients (name, patient_id) VALUES ($1, $2)');
      expect(params).toEqual(['John', 123]);
    });

    it('uses raw content when message is not JSON', async () => {
      const { pool, queryFn } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig({
        query: 'INSERT INTO raw_messages (body) VALUES (${content})',
      }), pool);
      await dispatcher.onStart();

      const result = await dispatcher.send(
        makeMessage({ content: 'MSH|^~\\&|SENDER' }),
        AbortSignal.timeout(5_000),
      );

      expect(result.ok).toBe(true);
      const [_sql, params] = queryFn.mock.calls[0]!;
      expect(params).toEqual(['MSH|^~\\&|SENDER']);
    });

    it('binds parameters from the message variables, as parameters, not SQL', async () => {
      const { pool, queryFn } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig({
        query: 'INSERT INTO patients (mrn, family) VALUES (${mrn}, ${family})',
      }), pool);
      await dispatcher.onStart();

      const result = await dispatcher.send(
        makeMessage({ content: 'MSH|^~\\&|EHR', variables: { mrn: 'MRN1', family: "O'BRIEN); DROP TABLE patients;--" } }),
        AbortSignal.timeout(5_000),
      );

      expect(result.ok).toBe(true);
      const [sql, params] = queryFn.mock.calls[0]!;
      expect(sql).toBe('INSERT INTO patients (mrn, family) VALUES ($1, $2)');
      expect(params).toEqual(['MRN1', "O'BRIEN); DROP TABLE patients;--"]);
    });

    it('lets a field of a JSON message win over a variable of the same name', async () => {
      const { pool, queryFn } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig({ query: 'INSERT INTO t (a) VALUES (${name})' }), pool);
      await dispatcher.onStart();

      await dispatcher.send(makeMessage({ content: '{"name":"from json"}', variables: { name: 'from map' } }), AbortSignal.timeout(5_000));

      expect(queryFn.mock.calls[0]![1]).toEqual(['from json']);
    });
  });

  describe('send (transaction mode)', () => {
    it('runs the prepared query inside one pool transaction', async () => {
      const { pool, queryFn, transactionFn, txQueryFn } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig({ useTransaction: true, returnGeneratedKeys: true }), pool);
      await dispatcher.onStart();

      const result = await dispatcher.send(makeMessage({ content: 'hello' }), AbortSignal.timeout(5_000));

      expect(result.ok && result.value.content).toBe('[{"id":7}]');
      expect(transactionFn).toHaveBeenCalledTimes(1);
      expect(txQueryFn).toHaveBeenCalledWith(
        'INSERT INTO messages (content, channel_id) VALUES ($1, $2)',
        ['hello', '00000000-0000-0000-0000-000000000001'],
      );
      expect(queryFn).not.toHaveBeenCalled();
    });

    it('fails the send when the transaction fails', async () => {
      const { pool, txQueryFn } = makeMockPool();
      txQueryFn.mockRejectedValue(new Error('Constraint violation'));
      dispatcher = new DatabaseDispatcher(makeConfig({ useTransaction: true }), pool);
      await dispatcher.onStart();

      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.message).toContain('Constraint violation');
    });
  });

  describe('send (MySQL)', () => {
    it('writes ? placeholders, passing a value once per use', async () => {
      const { pool, queryFn } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig({
        vendor: DATABASE_VENDOR.MYSQL,
        query: 'INSERT INTO t (a, b, c) VALUES (${content}, ${channelId}, ${content})',
      }), pool);
      await dispatcher.onStart();

      await dispatcher.send(makeMessage({ content: 'x' }), AbortSignal.timeout(5_000));

      expect(queryFn).toHaveBeenCalledWith('INSERT INTO t (a, b, c) VALUES (?, ?, ?)', ['x', '00000000-0000-0000-0000-000000000001', 'x']);
    });
  });

  describe('lifecycle', () => {
    it('stops and destroys pool', async () => {
      const { pool, destroyFn } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig(), pool);
      await dispatcher.onStart();

      const stopResult = await dispatcher.onStop();
      expect(stopResult.ok).toBe(true);
      expect(destroyFn).toHaveBeenCalledTimes(1);

      dispatcher = null;
    });

    it('halt destroys pool', async () => {
      const { pool, destroyFn } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig(), pool);
      await dispatcher.onStart();

      const haltResult = await dispatcher.onHalt();
      expect(haltResult.ok).toBe(true);
      expect(destroyFn).toHaveBeenCalledTimes(1);

      dispatcher = null;
    });

    it('undeploy marks as not started', async () => {
      const { pool } = makeMockPool();
      dispatcher = new DatabaseDispatcher(makeConfig(), pool);
      await dispatcher.onStart();

      const undeployResult = await dispatcher.onUndeploy();
      expect(undeployResult.ok).toBe(true);

      // Should fail on send since no longer started
      const sendResult = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));
      expect(sendResult.ok).toBe(false);

      dispatcher = null;
    });
  });
});
