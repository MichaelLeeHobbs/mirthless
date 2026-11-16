// ===========================================
// Data Source Pool Manager
// ===========================================
// Keeps one pooled connection per data source (keyed by id), reused across
// dbQuery calls. Read-only sources run inside a READ ONLY transaction so a write
// fails at the database even if the DB role is over-privileged. Pools are
// invalidated on config change / delete and destroyed on shutdown.
// See docs/design/11-datasources.md.

import { ConnectionPool, type PoolConfig } from '@galvanigraph/connectors';

/** Resolved data source (decrypted) needed to open a pool and run a query. */
export interface PooledDataSource {
  readonly id: string;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly readOnly: boolean;
  readonly tls: boolean;
  readonly maxConnections: number;
  readonly statementTimeoutMs: number;
  readonly maxRows: number;
}

interface CachedPool {
  readonly pool: ConnectionPool;
  readonly signature: string;
}

const IDLE_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

export class DataSourcePoolManager {
  private readonly pools = new Map<string, CachedPool>();

  /** Connection-affecting fields; a change rebuilds the pool. */
  private signatureOf(s: PooledDataSource): string {
    return [s.host, s.port, s.database, s.user, s.password, s.tls, s.maxConnections, s.statementTimeoutMs].join('\0');
  }

  private async getPool(s: PooledDataSource): Promise<ConnectionPool> {
    const signature = this.signatureOf(s);
    const cached = this.pools.get(s.id);
    if (cached && cached.signature === signature) return cached.pool;
    if (cached) {
      this.pools.delete(s.id);
      await cached.pool.destroy();
    }
    const pool = new ConnectionPool();
    const config: PoolConfig = {
      host: s.host,
      port: s.port,
      database: s.database,
      user: s.user,
      password: s.password,
      maxConnections: s.maxConnections,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      connectionTimeoutMs: CONNECT_TIMEOUT_MS,
      statementTimeoutMs: s.statementTimeoutMs,
      tls: s.tls,
    };
    const created = await pool.create(config);
    if (!created.ok) throw new Error(created.error.message);
    this.pools.set(s.id, { pool, signature });
    return pool;
  }

  /** Run a parameterized query, enforcing read-only and the row cap. */
  async runQuery(s: PooledDataSource, sql: string, params: readonly unknown[]): Promise<readonly Record<string, unknown>[]> {
    const pool = await this.getPool(s);
    const rows = s.readOnly ? await this.runReadOnly(pool, sql, params) : await this.runReadWrite(pool, sql, params);
    if (rows.length > s.maxRows) {
      throw new Error(`Query returned ${String(rows.length)} rows, exceeding maxRows=${String(s.maxRows)} for this data source`);
    }
    return rows;
  }

  private async runReadOnly(pool: ConnectionPool, sql: string, params: readonly unknown[]): Promise<readonly Record<string, unknown>[]> {
    const result = await pool.queryReadOnly(sql, params);
    if (!result.ok) throw new Error(result.error.message);
    return result.value.rows;
  }

  private async runReadWrite(pool: ConnectionPool, sql: string, params: readonly unknown[]): Promise<readonly Record<string, unknown>[]> {
    const result = await pool.query(sql, params);
    if (!result.ok) throw new Error(result.error.message);
    return result.value.rows;
  }

  /** Drop the pool for a data source (call on update/delete). */
  async invalidate(id: string): Promise<void> {
    const cached = this.pools.get(id);
    if (!cached) return;
    this.pools.delete(id);
    await cached.pool.destroy();
  }

  /** Destroy every pool (call on server shutdown). */
  async shutdown(): Promise<void> {
    const all = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(all.map((c) => c.pool.destroy()));
  }
}

/** Process-wide singleton shared by DataSourceService and the dbQuery bridge. */
export const dataSourcePoolManager = new DataSourcePoolManager();
