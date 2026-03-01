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
}

// ----- Query Result -----

export interface QueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number;
}

// ----- Connection Pool -----

export class ConnectionPool {
  private pool: pg.Pool | null = null;

  /** Create the underlying pg.Pool from config. */
  async create(config: PoolConfig): Promise<Result<void>> {
    return tryCatch(async () => {
      this.pool = new pg.Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        max: config.maxConnections,
        idleTimeoutMillis: config.idleTimeoutMs,
        connectionTimeoutMillis: config.connectionTimeoutMs,
      });

      // Verify connectivity with a simple ping
      const client = await this.pool.connect();
      client.release();
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
