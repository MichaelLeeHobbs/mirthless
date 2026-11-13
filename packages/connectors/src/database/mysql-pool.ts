// ===========================================
// MySQL Connection Pool
// ===========================================
// The DatabasePool for MySQL and MariaDB (`mysql2`), so the database connectors
// can talk to a partner's MySQL as well as PostgreSQL.

import mysql from 'mysql2/promise';
import { tryCatch, type Result } from '@galvaniflow/core-util';
import type { DatabasePool, PoolConfig, QueryResult, TxQuery } from './connection-pool.js';

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

type Queryable = Pick<mysql.Pool, 'execute' | 'query'>;

/**
 * Run one statement. Rows come back for a SELECT; a write returns its affected
 * row count and, as its one row, the id it generated. A statement with
 * parameters is a server-side prepared statement; one without (SAVEPOINT,
 * which the prepared protocol does not take everywhere) is sent as written.
 */
async function run(target: Queryable, sql: string, params: readonly unknown[], timeoutMs: number): Promise<QueryResult> {
  // mysql2 refuses undefined; pg sends it as NULL, and so do we.
  const values: unknown[] = params.map((p) => (p === undefined ? null : p));
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

/** MySQL pool (`mysql2`). */
export class MysqlPool implements DatabasePool {
  private pool: mysql.Pool | null = null;
  private timeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS;

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
      const connection = await this.pool.getConnection();
      connection.release();
    });
  }

  private requirePool(): mysql.Pool {
    if (!this.pool) throw new Error('Pool not initialized — call create() first');
    return this.pool;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Result<QueryResult>> {
    return tryCatch(async () => run(this.requirePool(), sql, params, this.timeoutMs));
  }

  async transaction<T>(fn: (tx: TxQuery) => Promise<T>): Promise<Result<T>> {
    return tryCatch(async () => {
      const connection = await this.requirePool().getConnection();
      try {
        await connection.beginTransaction();
        const value = await fn({ query: (sql, params) => run(connection, sql, params, this.timeoutMs) });
        await connection.commit();
        return value;
      } catch (err) {
        try {
          await connection.rollback();
        } catch {
          // A failed rollback (a dropped connection) is less useful than the original error.
        }
        throw err;
      } finally {
        connection.release();
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
