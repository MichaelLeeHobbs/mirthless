// database-mysql.itest.ts runs the same against a real MySQL. No test runs against MariaDB.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OK = [{ affectedRows: 0, insertId: 0 }, undefined];
const INTERRUPTED = Object.assign(new Error('Query execution was interrupted'), { errno: 1317, code: 'ER_QUERY_INTERRUPTED' });
const NO_ANSWER = Object.assign(new Error('Query inactivity timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' });

/** Answers as a server of this name does; everything else is OK. */
function answer(server: string): (options: { sql: string }) => Promise<unknown> {
  return async ({ sql }) => (sql.includes('CONNECTION_ID()') ? [[{ name: server, id: 77 }], []] : OK);
}

function makeConnection(): {
  connection: object; execute: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>;
} {
  return { connection: {}, execute: vi.fn(), query: vi.fn(answer('db1')), release: vi.fn(), destroy: vi.fn() };
}

let connection = makeConnection();
const pool = { getConnection: vi.fn(), end: vi.fn() };
const createPool = vi.fn((_options: object) => pool);
function deferred(): { readonly promise: Promise<unknown>; readonly resolve: (value: unknown) => void; readonly reject: (err: Error) => void } {
  let resolve: (value: unknown) => void = () => {};
  let reject: (err: Error) => void = () => {};
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** The connection that stops a statement on another. */
let stopper = makeConnection();
const createConnection = vi.fn(async (_options: object) => stopper);

vi.mock('mysql2/promise', () => ({ default: { createPool, createConnection } }));

const { MysqlPool } = await import('../mysql-pool.js');

const CONFIG = {
  host: 'db', port: 3306, database: 'partner', user: 'u', password: 'p',
  maxConnections: 5, idleTimeoutMs: 30_000, connectionTimeoutMs: 10_000, statementTimeoutMs: 30_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  connection = makeConnection();
  stopper = makeConnection();
  pool.getConnection.mockImplementation(async () => connection);
});

async function created(): Promise<InstanceType<typeof MysqlPool>> {
  const p = new MysqlPool();
  const result = await p.create(CONFIG);
  expect(result.ok).toBe(true);
  return p;
}

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
    expect(limits.map((call) => [(call[0] as { sql: string }).sql, call[1]])).toEqual([
      ['SET SESSION innodb_lock_wait_timeout = ?, SESSION lock_wait_timeout = ?', [25, 25]],
      ['SET SESSION max_execution_time = ?', [25_000]],
    ]);
  });

  it('sets max_statement_time, in seconds, on a server that does not know max_execution_time', async () => {
    connection.query.mockImplementation(async (options: { sql: string }) => {
      if (options.sql.includes('max_execution_time')) throw Object.assign(new Error("Unknown system variable 'max_execution_time'"), { errno: 1193 });
      return answer('mariadb')(options);
    });
    await created();
    expect(connection.query).toHaveBeenCalledWith({ sql: 'SET SESSION max_statement_time = ?', timeout: 30_000 }, [25]);
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it('fails create, closing the connection, when the limits cannot be set', async () => {
    connection.query.mockRejectedValue(Object.assign(new Error('access denied'), { errno: 1227 }));
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
    expect(connection.execute.mock.calls[0]![0]).toMatchObject({ timeout: 30_000 });
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

  it('ends the pool only when the transaction in flight has committed', async () => {
    const p = await created();
    let finish = (): void => {};
    const transaction = p.transaction(() => new Promise<void>((resolve) => { finish = resolve; }));
    await vi.waitFor(() => expect(statements()).toContain('START TRANSACTION'));

    const destroyed = p.destroy();
    finish();
    await destroyed;

    expect((await transaction).ok).toBe(true);
    const committed = connection.query.mock.invocationCallOrder[statements().indexOf('COMMIT')]!;
    expect(pool.end.mock.invocationCallOrder[0]).toBeGreaterThan(committed);
  });
});

describe('MysqlPool when a statement is over its limit', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** A statement that has no answer yet. */
  function pending(): ReturnType<typeof deferred> {
    const statement = deferred();
    connection.execute.mockReturnValueOnce(statement.promise);
    return statement;
  }

  function stops(): unknown[] {
    return stopper.query.mock.calls.filter((call) => (call[0] as { sql: string }).sql.startsWith('KILL')).map((call) => [(call[0] as { sql: string }).sql, call[1]]);
  }

  it('stops it on the server 5 s before the client gives up, and reports the answer', async () => {
    const p = await created();
    connection.release.mockClear();
    const statement = pending();
    const result = p.query('INSERT INTO t VALUES (?)', [1]);

    await vi.advanceTimersByTimeAsync(24_999);
    expect(createConnection).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(stops()).toEqual([['KILL QUERY ?', [77]]]);
    statement.reject(INTERRUPTED);

    const failed = await result;
    expect(!failed.ok && failed.error.message).toBe('Query execution was interrupted');
    expect(stopper.destroy).toHaveBeenCalledTimes(1);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
  });

  it('reports one that was done all the same as done', async () => {
    const p = await created();
    const statement = pending();
    const result = p.query('INSERT INTO t VALUES (?)', [1]);
    await vi.advanceTimersByTimeAsync(25_000);
    statement.resolve([{ affectedRows: 1, insertId: 0 }, undefined]);

    expect(await result).toMatchObject({ ok: true, value: { rowCount: 1 } });
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it('stops nothing on another server, and says the statement may still take effect', async () => {
    stopper.query.mockImplementation(answer('db2'));
    const p = await created();
    const statement = pending();
    const result = p.query('INSERT INTO t VALUES (?)', [1]);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(stops()).toEqual([]);
    expect(stopper.destroy).toHaveBeenCalledTimes(1);
    statement.reject(NO_ANSWER);

    const failed = await result;
    expect(!failed.ok && failed.error.message).toBe('Query inactivity timeout; the server gave no answer, so the statement may still take effect');
  });

  it.each([
    ['cannot be opened', (): void => { createConnection.mockRejectedValueOnce(new Error('Too many connections')); }],
    ['never opens', (): void => { createConnection.mockReturnValueOnce(new Promise<never>(() => {})); }],
  ])('reports no answer when the connection to stop it on %s', async (_what, prepare) => {
    prepare();
    const p = await created();
    const statement = pending();
    const result = p.query('INSERT INTO t VALUES (?)', [1]);
    await vi.advanceTimersByTimeAsync(25_000);
    statement.reject(NO_ANSWER);
    await vi.advanceTimersByTimeAsync(5_000);

    const failed = await result;
    expect(!failed.ok && failed.error.message).toContain('may still take effect');
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it('rolls back the transaction of a stopped statement, then closes its connection', async () => {
    const p = await created();
    const statement = pending();
    const result = p.transaction((tx) => tx.query('INSERT INTO t VALUES (?)', [1]));
    await vi.advanceTimersByTimeAsync(25_000);
    statement.reject(INTERRUPTED);

    expect((await result).ok).toBe(false);
    expect(statements().at(-1)).toBe('ROLLBACK');
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not stop a COMMIT, and says one without an answer may still take effect', async () => {
    const p = await created();
    const commit = deferred();
    connection.query.mockImplementation((options: { sql: string }) => (options.sql === 'COMMIT' ? commit.promise : answer('db1')(options)));
    const result = p.transaction(async () => 'done');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(createConnection).not.toHaveBeenCalled();
    commit.reject(NO_ANSWER);

    const failed = await result;
    expect(!failed.ok && failed.error.message).toContain('may still take effect');
    expect(statements()).not.toContain('ROLLBACK');
  });

  it('leaves a statement that ends in time alone', async () => {
    const p = await created();
    connection.execute.mockResolvedValue(OK);
    await p.query('INSERT INTO t VALUES (?)', [1]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(createConnection).not.toHaveBeenCalled();
    expect(connection.destroy).not.toHaveBeenCalled();
  });
});
