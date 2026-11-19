// Serves MySQL and MariaDB.

import mysql from 'mysql2/promise';
import { tryCatch, type Result } from '@galvanigraph/core-util';
import type { DatabasePool, PoolConfig, QueryResult, TxQuery } from './connection-pool.js';

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
/** How much sooner the server gives up than the client, so the server's error is the one that arrives. */
const SERVER_MARGIN_MS = 5_000;

type Queryable = Pick<mysql.PoolConnection, 'execute' | 'query'>;

/**
 * A write returns its affected row count and, as its one row, the generated id. A statement
 * without parameters is sent as written: the prepared protocol does not take SAVEPOINT everywhere.
 */
async function run(target: Queryable, sql: string, params: readonly unknown[], timeoutMs: number): Promise<QueryResult> {
  // mysql2 refuses undefined; pg sends it as NULL, and so do we.
  const values = params.map((p) => (p === undefined ? null : p)) as mysql.ExecuteValues & unknown[];
  const [result] = values.length > 0
    ? await target.execute({ sql, timeout: timeoutMs }, values)
    : await target.query({ sql, timeout: timeoutMs });
  if (Array.isArray(result)) {
    const rows = result as Record<string, unknown>[];
    return { rows, rowCount: rows.length };
  }
  const header = result as mysql.ResultSetHeader;
  return { rows: header.insertId ? [{ insertId: header.insertId }] : [], rowCount: header.affectedRows };
}

/** Hand a connection back, or close it when an error or timeout may have left it mid-statement. */
function finish(connection: mysql.PoolConnection, broken: boolean): void {
  if (broken) connection.destroy();
  else connection.release();
}

/** A timeout or a lost connection, after which the connection's state is unknown. A plain SQL error (a duplicate key) is not. */
function isBroken(err: unknown): boolean {
  const e = err as { fatal?: unknown; code?: unknown } | null;
  return e?.fatal === true || e?.code === 'PROTOCOL_SEQUENCE_TIMEOUT';
}

export class MysqlPool implements DatabasePool {
  private pool: mysql.Pool | null = null;
  private timeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS;
  /** Connections whose session limits are set, by their underlying connection. */
  private readonly limited = new WeakSet<object>();

  async create(config: PoolConfig): Promise<Result<void>> {
    return tryCatch(async () => {
      this.timeoutMs = config.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
      this.pool = mysql.createPool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        connectionLimit: config.maxConnections,
        idleTimeout: config.idleTimeoutMs,
        connectTimeout: config.connectionTimeoutMs,
        ...(config.tls === true ? { ssl: { rejectUnauthorized: true } } : {}),
        // Values stay exact: big integers, decimals and dates come back as text.
        supportBigNumbers: true,
        bigNumberStrings: true,
        decimalNumbers: false,
        dateStrings: true,
      });
      finish(await this.connection(), false);
    });
  }

  /**
   * Server-side limits below the client timeout: the client timeout alone does not stop the
   * statement, so an INSERT waiting on a lock could commit after the client gave up and the
   * queue's retry write the row twice.
   */
  private async connection(): Promise<mysql.PoolConnection> {
    if (!this.pool) throw new Error('Pool not initialized — call create() first');
    const connection = await this.pool.getConnection();
    const underlying = (connection as unknown as { connection: object }).connection;
    if (this.limited.has(underlying)) return connection;
    const serverMs = Math.max(1_000, this.timeoutMs - SERVER_MARGIN_MS);
    try {
      await connection.query(
        { sql: 'SET SESSION innodb_lock_wait_timeout = ?, SESSION max_execution_time = ?', timeout: this.timeoutMs },
        [Math.ceil(serverMs / 1_000), serverMs],
      );
    } catch (err) {
      finish(connection, true);
      throw err;
    }
    this.limited.add(underlying);
    return connection;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Result<QueryResult>> {
    return tryCatch(async () => {
      const connection = await this.connection();
      try {
        const result = await run(connection, sql, params, this.timeoutMs);
        finish(connection, false);
        return result;
      } catch (err) {
        finish(connection, isBroken(err));
        throw err;
      }
    });
  }

  async transaction<T>(fn: (tx: TxQuery) => Promise<T>): Promise<Result<T>> {
    return tryCatch(async () => {
      const connection = await this.connection();
      // Every statement, COMMIT included, has the timeout: a connection that
      // drops during COMMIT must fail the poll, not hang it.
      const statement = (sql: string): Promise<QueryResult> => run(connection, sql, [], this.timeoutMs);
      try {
        await statement('START TRANSACTION');
        const value = await fn({ query: (sql, params) => run(connection, sql, params, this.timeoutMs) });
        await statement('COMMIT');
        finish(connection, false);
        return value;
      } catch (err) {
        // A connection the rollback could not reach is closed, never reused mid-transaction.
        const rolledBack = !isBroken(err) && await statement('ROLLBACK').then(() => true, () => false);
        finish(connection, !rolledBack);
        throw err;
      }
    });
  }

  async destroy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.pool) {
        await this.pool.end();
        this.pool = null;
      }
    });
  }
}
