// ===========================================
// MySQL Pool Tests
// ===========================================
// mysql2 is the network boundary, so it is faked here. S15 in the migration
// scenario suite runs the Database Writer against a real MySQL.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const OK = [{ affectedRows: 0, insertId: 0 }, undefined];

function makeConnection(): {
  connection: object; execute: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>;
} {
  return { connection: {}, execute: vi.fn(), query: vi.fn().mockResolvedValue(OK), release: vi.fn(), destroy: vi.fn() };
}

let connection = makeConnection();
const pool = { getConnection: vi.fn(), end: vi.fn() };
const createPool = vi.fn(() => pool);

vi.mock('mysql2/promise', () => ({ default: { createPool } }));

const { MysqlPool } = await import('../mysql-pool.js');

const CONFIG = {
  host: 'db', port: 3306, database: 'partner', user: 'u', password: 'p',
  maxConnections: 5, idleTimeoutMs: 30_000, connectionTimeoutMs: 10_000, statementTimeoutMs: 30_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  connection = makeConnection();
  pool.getConnection.mockImplementation(async () => connection);
});

async function created(): Promise<InstanceType<typeof MysqlPool>> {
  const p = new MysqlPool();
  const result = await p.create(CONFIG);
  expect(result.ok).toBe(true);
  return p;
}

/** The SQL text of each query() call on the connection, in order. */
function statements(): string[] {
  return connection.query.mock.calls.map((call) => (call[0] as { sql: string }).sql);
}

describe('MysqlPool', () => {
  it('creates a pool that keeps values exact, and uses TLS only when asked', async () => {
    await created();
    expect(createPool).toHaveBeenCalledWith(expect.objectContaining({
      host: 'db', port: 3306, database: 'partner', connectionLimit: 5,
      supportBigNumbers: true, bigNumberStrings: true, dateStrings: true,
    }));
    expect(createPool.mock.calls[0]![0]).not.toHaveProperty('ssl');
    expect(connection.release).toHaveBeenCalledTimes(1);

    await new MysqlPool().create({ ...CONFIG, tls: true });
    expect(createPool.mock.calls[1]![0]).toMatchObject({ ssl: { rejectUnauthorized: true } });
  });

  it('sets server-side limits below the client timeout, once per connection', async () => {
    const p = await created();
    connection.execute.mockResolvedValue([[], []]);
    await p.query('SELECT 1 WHERE ? = 1', [1]);
    await p.query('SELECT 1 WHERE ? = 1', [1]);

    const limits = connection.query.mock.calls.filter((call) => (call[0] as { sql: string }).sql.startsWith('SET SESSION'));
    expect(limits).toHaveLength(1);
    expect(limits[0]![1]).toEqual([25, 25_000]);
  });

  it('fails create, closing the connection, when the limits cannot be set', async () => {
    connection.query.mockRejectedValue(new Error('access denied'));
    const result = await new MysqlPool().create(CONFIG);
    expect(!result.ok && result.error.message).toContain('access denied');
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it('fails create when the database cannot be reached', async () => {
    pool.getConnection.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await new MysqlPool().create(CONFIG);
    expect(!result.ok && result.error.message).toContain('ECONNREFUSED');
  });

  it('returns selected rows, sending undefined parameters as NULL with the statement timeout', async () => {
    const p = await created();
    connection.execute.mockResolvedValue([[{ a: '1' }, { a: '2' }], []]);

    const result = await p.query('SELECT a FROM t WHERE b = ? AND c = ?', ['x', undefined]);

    expect(result.ok && result.value).toEqual({ rows: [{ a: '1' }, { a: '2' }], rowCount: 2 });
    expect(connection.execute).toHaveBeenCalledWith({ sql: 'SELECT a FROM t WHERE b = ? AND c = ?', timeout: 30_000 }, ['x', null]);
  });

  it('returns a write as its affected rows and generated id', async () => {
    const p = await created();
    connection.execute.mockResolvedValue([{ affectedRows: 1, insertId: 42 }, undefined]);
    expect(await p.query('INSERT INTO t VALUES (?)', [1])).toMatchObject({ ok: true, value: { rows: [{ insertId: 42 }], rowCount: 1 } });

    connection.execute.mockResolvedValue([{ affectedRows: 3, insertId: 0 }, undefined]);
    expect(await p.query('UPDATE t SET a = ?', [1])).toMatchObject({ ok: true, value: { rows: [], rowCount: 3 } });
  });

  it('sends a statement without parameters as written', async () => {
    const p = await created();
    await p.query('SAVEPOINT ack_row', []);
    expect(statements()).toContain('SAVEPOINT ack_row');
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it('returns a connection after a SQL error, and closes one after a timeout', async () => {
    const p = await created();
    connection.release.mockClear();
    connection.execute.mockRejectedValueOnce(Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' }));
    expect((await p.query('INSERT INTO t VALUES (?)', [1])).ok).toBe(false);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).not.toHaveBeenCalled();

    connection.execute.mockRejectedValueOnce(Object.assign(new Error('Query inactivity timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' }));
    expect((await p.query('INSERT INTO t VALUES (?)', [1])).ok).toBe(false);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it('commits a transaction whose callback resolves, every statement with the timeout', async () => {
    const p = await created();
    connection.execute.mockResolvedValue([[{ id: 1 }], []]);

    const result = await p.transaction(async (tx) => (await tx.query('SELECT id FROM t WHERE a = ? FOR UPDATE SKIP LOCKED', [1])).rows);

    expect(result.ok && result.value).toEqual([{ id: 1 }]);
    expect(statements().slice(-2)).toEqual(['START TRANSACTION', 'COMMIT']);
    for (const call of connection.query.mock.calls) expect((call[0] as { timeout: number }).timeout).toBe(30_000);
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it('rolls back and reports the callback error, returning the connection', async () => {
    const p = await created();
    const result = await p.transaction(async () => { throw new Error('duplicate key'); });

    expect(!result.ok && result.error.message).toContain('duplicate key');
    expect(statements()).toContain('ROLLBACK');
    expect(statements()).not.toContain('COMMIT');
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it('closes the connection when the rollback fails or the connection broke, reporting the first error', async () => {
    const p = await created();
    connection.query.mockImplementation(async (opts: { sql: string }) => {
      if (opts.sql === 'ROLLBACK') throw new Error('connection lost');
      return OK;
    });
    const result = await p.transaction(async () => { throw new Error('duplicate key'); });
    expect(!result.ok && result.error.message).toContain('duplicate key');
    expect(connection.destroy).toHaveBeenCalledTimes(1);

    connection.query.mockImplementation(async (opts: { sql: string }) => {
      if (opts.sql === 'COMMIT') throw Object.assign(new Error('Connection lost'), { fatal: true });
      return OK;
    });
    const commitLost = await p.transaction(async () => 'done');
    expect(!commitLost.ok && commitLost.error.message).toContain('Connection lost');
    expect(connection.destroy).toHaveBeenCalledTimes(2);
  });

  it('refuses queries before create, and ends the pool once on destroy', async () => {
    const fresh = new MysqlPool();
    expect((await fresh.query('SELECT 1', [])).ok).toBe(false);
    expect((await fresh.destroy()).ok).toBe(true);

    const p = await created();
    await p.destroy();
    await p.destroy();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
