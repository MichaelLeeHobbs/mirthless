// ===========================================
// Database Connection Pool
// ===========================================
// Thin wrapper around pg.Pool with Result<T> returns.

import pg from 'pg';
import { tryCatch, type Result } from '@mirthless/core-util';

// ----- Config -----

export interface PoolConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly maxConnections: number;
  readonly idleTimeoutMs: number;
  readonly connectionTimeoutMs: number;
  /**
   * Server-enforced per-statement timeout (ms). A hung query is cancelled by
   * PostgreSQL after this budget, so a stuck poll cannot wedge the connector.
   * Defaults to 30s when omitted.
   */
  readonly statementTimeoutMs?: number;
}

/** Default statement/query timeout when a PoolConfig does not specify one. */
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

// ----- Query Result -----

export interface QueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number;
}

/**
 * A query interface bound to a single transaction's client. Queries throw on
 * error so a failure aborts the enclosing transaction (rolling it back).
 */
export interface TxQuery {
  query(sql: string, params: readonly unknown[]): Promise<QueryResult>;
}

// ----- Connection Pool -----

export class ConnectionPool {
  private pool: pg.Pool | null = null;

  /** Create the underlying pg.Pool from config. */
  async create(config: PoolConfig): Promise<Result<void>> {
    return tryCatch(async () => {
      const timeoutMs = config.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
      this.pool = new pg.Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        max: config.maxConnections,
        idleTimeoutMillis: config.idleTimeoutMs,
        connectionTimeoutMillis: config.connectionTimeoutMs,
        // Server-side cancel of any statement exceeding the budget, plus a
        // client-side guard in case the socket itself hangs.
        statement_timeout: timeoutMs,
        query_timeout: timeoutMs,
      });

      // Verify connectivity with a simple ping
      const client = await this.pool.connect();
      client.release();
    });
  }

  /**
   * Run `fn` inside a single transaction on a dedicated client (BEGIN/COMMIT,
   * ROLLBACK on throw). The client is always released. Used by the source
   * receiver to hold row locks (SELECT ... FOR UPDATE SKIP LOCKED) across the
   * dispatch+ack of a batch so a concurrent poller cannot claim the same rows.
   */
  async transaction<T>(fn: (tx: TxQuery) => Promise<T>): Promise<Result<T>> {
    return tryCatch(async () => {
      if (!this.pool) {
        throw new Error('Pool not initialized — call create() first');
      }
      const client = await this.pool.connect();
      const tx: TxQuery = {
        query: async (sql, params) => {
          const result = await client.query(sql, [...params]);
          return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
        },
      };
      try {
        await client.query('BEGIN');
        const value = await fn(tx);
        await client.query('COMMIT');
        return value;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Rollback failure (e.g. broken connection) is subordinate to the
          // original error — surface that one.
        }
        throw err;
      } finally {
        client.release();
      }
    });
  }

  /** Execute a parameterized query and return rows. */
  async query(sql: string, params: readonly unknown[]): Promise<Result<QueryResult>> {
    return tryCatch(async () => {
      if (!this.pool) {
        throw new Error('Pool not initialized — call create() first');
      }
      const result = await this.pool.query(sql, [...params]);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount ?? 0,
      };
    });
  }

  /** Acquire a client for transaction use. */
  async acquireClient(): Promise<Result<pg.PoolClient>> {
    return tryCatch(async () => {
      if (!this.pool) {
        throw new Error('Pool not initialized — call create() first');
      }
      return this.pool.connect();
    });
  }

  /** Drain and close the pool. */
  async destroy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.pool) {
        await this.pool.end();
        this.pool = null;
      }
    });
  }
}
