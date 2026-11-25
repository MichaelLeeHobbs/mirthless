import pg from 'pg';
import { tryCatch, type Result } from '@galvanigraph/core-util';
import { POSTGRES_TYPES } from './postgres-values.js';

export interface PoolConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly maxConnections: number;
  readonly idleTimeoutMs: number;
  readonly connectionTimeoutMs: number;
  /** Enforced by the server, so a stuck poll cannot wedge the connector. */
  readonly statementTimeoutMs?: number;
  /** Verifies against the system trust store. Without it, rows and credentials travel in plain text. */
  readonly tls?: boolean;
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
/** How much later the client gives up than the server, so the server's answer is the one that arrives. */
const CLIENT_MARGIN_MS = 5_000;

export interface ConnectorConnection {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly username: string;
  readonly password: string;
  readonly tls?: boolean;
}

export function toPoolConfig(connection: ConnectorConnection, statementTimeoutMs?: number): PoolConfig {
  return {
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: connection.password,
    maxConnections: 5,
    idleTimeoutMs: 30_000,
    connectionTimeoutMs: 10_000,
    tls: connection.tls === true,
    ...(statementTimeoutMs === undefined ? {} : { statementTimeoutMs }),
  };
}

export interface QueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number;
}

/** Throws on error, so a failure rolls back the enclosing transaction. */
export interface TxQuery {
  query(sql: string, params: readonly unknown[]): Promise<QueryResult>;
}

export interface DatabasePool {
  create(config: PoolConfig): Promise<Result<void>>;
  query(sql: string, params: readonly unknown[]): Promise<Result<QueryResult>>;
  /** One statement in a transaction that cannot write. */
  queryReadOnly(sql: string, params: readonly unknown[]): Promise<Result<QueryResult>>;
  /** Run `fn` in one transaction: committed when it resolves, rolled back when it throws. */
  transaction<T>(fn: (tx: TxQuery) => Promise<T>): Promise<Result<T>>;
  destroy(): Promise<Result<void>>;
}

export class ConnectionPool implements DatabasePool {
  private pool: pg.Pool | null = null;

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
        ssl: config.tls === true ? { rejectUnauthorized: true } : false,
        types: POSTGRES_TYPES,
        // Server-side cancel of any statement exceeding the budget, plus a
        // client-side guard in case the socket itself hangs.
        statement_timeout: timeoutMs,
        query_timeout: timeoutMs + CLIENT_MARGIN_MS,
      });

      const client = await this.pool.connect();
      client.release();
    });
  }

  /** The receiver holds row locks (FOR UPDATE SKIP LOCKED) across a batch's dispatch and ack, so a concurrent poller cannot claim the same rows. */
  async transaction<T>(fn: (tx: TxQuery) => Promise<T>): Promise<Result<T>> {
    return this.runInTransaction('BEGIN', false, fn);
  }

  /** The extended query protocol takes one statement, so `COMMIT; DELETE FROM t` cannot end the read-only transaction. */
  async queryReadOnly(sql: string, params: readonly unknown[]): Promise<Result<QueryResult>> {
    return this.runInTransaction('BEGIN READ ONLY', true, (tx) => tx.query(sql, params));
  }

  private async runInTransaction<T>(begin: string, extended: boolean, fn: (tx: TxQuery) => Promise<T>): Promise<Result<T>> {
    return tryCatch(async () => {
      if (!this.pool) {
        throw new Error('Pool not initialized — call create() first');
      }
      const client = await this.pool.connect();
      const tx: TxQuery = {
        query: async (sql, params) => {
          const result = await client.query({ text: sql, values: [...params], ...(extended ? { queryMode: 'extended' as const } : {}) });
          return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
        },
      };
      let broken = false;
      try {
        await client.query(begin);
        const value = await fn(tx);
        await client.query('COMMIT');
        return value;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Subordinate to the original error, which is the one to surface. The connection
          // may still be in the transaction, so it is closed instead of used again.
          broken = true;
        }
        throw err;
      } finally {
        client.release(broken);
      }
    });
  }

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

  async acquireClient(): Promise<Result<pg.PoolClient>> {
    return tryCatch(async () => {
      if (!this.pool) {
        throw new Error('Pool not initialized — call create() first');
      }
      return this.pool.connect();
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
