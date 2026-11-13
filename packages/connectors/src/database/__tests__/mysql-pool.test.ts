// ===========================================
// MySQL Pool Tests
// ===========================================
// mysql2 is the network boundary, so it is faked here. S15 in the migration
// scenario suite runs the Database Writer against a real MySQL.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const connection = {
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  execute: vi.fn(),
  query: vi.fn(),
};
const pool = {
  getConnection: vi.fn(),
  execute: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
};
const createPool = vi.fn(() => pool);

vi.mock('mysql2/promise', () => ({ default: { createPool } }));

const { MysqlPool } = await import('../mysql-pool.js');

const CONFIG = {
  host: 'db', port: 3306, database: 'partner', user: 'u', password: 'p',
  maxConnections: 5, idleTimeoutMs: 30_000, connectionTimeoutMs: 10_000, statementTimeoutMs: 1_234,
};

beforeEach(() => {
  vi.clearAllMocks();
  pool.getConnection.mockResolvedValue(connection);
  connection.beginTransaction.mockResolvedValue(undefined);
  connection.commit.mockResolvedValue(undefined);
  connection.rollback.mockResolvedValue(undefined);
});

async function created(): Promise<InstanceType<typeof MysqlPool>> {
  const p = new MysqlPool();
  const result = await p.create(CONFIG);
  expect(result.ok).toBe(true);
  return p;
}

describe('MysqlPool', () => {
  it('creates a pool that keeps values exact, checks a connection, and uses TLS only when asked', async () => {
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

  it('fails create when the database cannot be reached', async () => {
    pool.getConnection.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await new MysqlPool().create(CONFIG);
    expect(!result.ok && result.error.message).toContain('ECONNREFUSED');
  });

  it('returns selected rows, sending undefined parameters as NULL with the statement timeout', async () => {
    const p = await created();
    pool.execute.mockResolvedValue([[{ a: '1' }, { a: '2' }], []]);

    const result = await p.query('SELECT a FROM t WHERE b = ? AND c = ?', ['x', undefined]);

    expect(result.ok && result.value).toEqual({ rows: [{ a: '1' }, { a: '2' }], rowCount: 2 });
    expect(pool.execute).toHaveBeenCalledWith({ sql: 'SELECT a FROM t WHERE b = ? AND c = ?', timeout: 1_234 }, ['x', null]);
  });

  it('returns a write as its affected rows and generated id', async () => {
    const p = await created();
    pool.execute.mockResolvedValue([{ affectedRows: 1, insertId: 42 }, undefined]);
    expect(await p.query('INSERT INTO t VALUES (?)', [1])).toMatchObject({ ok: true, value: { rows: [{ insertId: 42 }], rowCount: 1 } });

    pool.execute.mockResolvedValue([{ affectedRows: 3, insertId: 0 }, undefined]);
    expect(await p.query('UPDATE t SET a = ?', [1])).toMatchObject({ ok: true, value: { rows: [], rowCount: 3 } });
  });

  it('sends a statement without parameters as written', async () => {
    const p = await created();
    pool.query.mockResolvedValue([{ affectedRows: 0, insertId: 0 }, undefined]);
    await p.query('SAVEPOINT ack_row', []);
    expect(pool.query).toHaveBeenCalledWith({ sql: 'SAVEPOINT ack_row', timeout: 1_234 });
    expect(pool.execute).not.toHaveBeenCalled();
  });

  it('commits a transaction whose callback resolves, on one connection', async () => {
    const p = await created();
    connection.execute.mockResolvedValue([[{ id: 1 }], []]);

    const result = await p.transaction(async (tx) => (await tx.query('SELECT id FROM t FOR UPDATE SKIP LOCKED WHERE a = ?', [1])).rows);

    expect(result.ok && result.value).toEqual([{ id: 1 }]);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(2); // the create check, then the transaction
  });

  it('rolls back and reports the callback error, even when the rollback fails too', async () => {
    const p = await created();
    connection.rollback.mockRejectedValue(new Error('connection lost'));

    const result = await p.transaction(async () => { throw new Error('duplicate key'); });

    expect(!result.ok && result.error.message).toContain('duplicate key');
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(2);
  });

  it('refuses queries before create, and ends the pool once on destroy', async () => {
    const fresh = new MysqlPool();
    expect(!((await fresh.query('SELECT 1', [])).ok)).toBe(true);
    expect((await fresh.destroy()).ok).toBe(true);

    const p = await created();
    await p.destroy();
    await p.destroy();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
