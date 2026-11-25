// Serves MySQL and MariaDB.

import mysql from 'mysql2/promise';
import { settleWithin, tryCatch, type Result } from '@galvanigraph/core-util';
import { TimeoutError, withTimeout } from '../timeout.js';
import type { DatabasePool, PoolConfig, QueryResult, TxQuery } from './connection-pool.js';

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
/** How much sooner the server gives up than the client, so the server's error is the one that arrives. */
const SERVER_MARGIN_MS = 5_000;
/** The server's name for itself, so a stop meant for one server behind a proxy never reaches another. */
const SERVER_NAME_SQL = "SELECT CONCAT_WS(':', @@hostname, @@port, @@server_id) AS name, CONNECTION_ID() AS id";
const UNKNOWN_VARIABLE = 1193;

type Queryable = Pick<mysql.PoolConnection, 'execute' | 'query'>;

/** What stops a connection's statement on the server. */
interface Session {
  /** Null when the server calls the connection otherwise than it did when it was opened: a proxy is in between, and a KILL is not for it. */
  readonly id: number | null;
  readonly server: string;
}

interface Connection {
  readonly connection: mysql.PoolConnection;
  readonly session: Session;
  /** A statement got no answer, or a stop that was sent did not: nothing more may be run on it. */
  lost: boolean;
  /** A stop was sent. */
  stopped: boolean;
}

/**
 * A write returns its affected row count and, as its one row, the generated id. A statement
 * without parameters is sent as written: the prepared protocol does not take SAVEPOINT everywhere.
 */
async function run(target: Queryable, sql: string, params: readonly unknown[], timeoutMs: number): Promise<QueryResult> {
  // mysql2 refuses undefined; pg sends it as NULL, and so do we.
  const values = params.map((p) => (p === undefined ? null : p)) as mysql.ExecuteValues & unknown[];
  // mysql2's own timeout does not cover preparing the statement.
  const [result] = await withTimeout(values.length > 0 ? target.execute(sql, values) : target.query(sql), timeoutMs, 'MySQL statement');
  if (Array.isArray(result)) {
    const rows = result as Record<string, unknown>[];
    return { rows, rowCount: rows.length };
  }
  const header = result as mysql.ResultSetHeader;
  return { rows: header.insertId ? [{ insertId: header.insertId }] : [], rowCount: header.affectedRows };
}

/** A timeout or a lost connection, after which the connection's state is unknown. A plain SQL error (a duplicate key) is not. */
function isBroken(err: unknown): boolean {
  const e = err as { fatal?: unknown; code?: unknown } | null;
  return e?.fatal === true || err instanceof TimeoutError;
}

async function serverSession(connection: Queryable & Pick<mysql.Connection, 'threadId'>, timeoutMs: number): Promise<Session> {
  const { rows } = await run(connection, SERVER_NAME_SQL, [], timeoutMs);
  const id = Number(rows[0]?.['id']);
  return { id: id === connection.threadId ? id : null, server: String(rows[0]?.['name']) };
}

export class MysqlPool implements DatabasePool {
  private pool: mysql.Pool | null = null;
  private options: mysql.ConnectionOptions = {};
  private timeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS;
  /** Connections whose session limits are set, by their underlying connection. */
  private readonly sessions = new WeakMap<object, Session>();
  /** What runs on the pool. */
  private inUse = new Set<Promise<unknown>>();

  async create(config: PoolConfig): Promise<Result<void>> {
    return tryCatch(async () => {
      this.timeoutMs = config.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
      this.options = {
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        connectTimeout: config.connectionTimeoutMs,
        ...(config.tls === true ? { ssl: { rejectUnauthorized: true } } : {}),
        // Values stay exact: big integers, decimals and dates come back as text.
        supportBigNumbers: true,
        bigNumberStrings: true,
        decimalNumbers: false,
        dateStrings: true,
      };
      this.inUse = new Set();
      this.pool = mysql.createPool({ ...this.options, connectionLimit: config.maxConnections, idleTimeout: config.idleTimeoutMs });
      this.finish(await this.connection());
    });
  }

  private get serverMs(): number {
    return Math.max(1_000, this.timeoutMs - SERVER_MARGIN_MS);
  }

  private async connection(): Promise<Connection> {
    if (!this.pool) throw new Error('Pool not initialized — call create() first');
    const connection = await this.pool.getConnection();
    const underlying = (connection as unknown as { connection: object }).connection;
    const known = this.sessions.get(underlying);
    if (known) return { connection, session: known, lost: false, stopped: false };
    try {
      await this.limit(connection);
      const session = await serverSession(connection, this.timeoutMs);
      this.sessions.set(underlying, session);
      return { connection, session, lost: false, stopped: false };
    } catch (err) {
      connection.destroy();
      throw err;
    }
  }

  /** What the server stops by itself: waiting for a row, waiting for a table, and a long SELECT (on MariaDB any long statement). */
  private async limit(connection: mysql.PoolConnection): Promise<void> {
    const seconds = Math.ceil(this.serverMs / 1_000);
    const set = (sql: string): Promise<QueryResult> => run(connection, sql, [], this.timeoutMs);
    await set(`SET SESSION innodb_lock_wait_timeout = ${String(seconds)}, SESSION lock_wait_timeout = ${String(seconds)}`);
    try {
      await set(`SET SESSION max_execution_time = ${String(this.serverMs)}`);
    } catch (err) {
      if ((err as { errno?: unknown }).errno !== UNKNOWN_VARIABLE) throw err;
      // MariaDB's, in seconds.
      await set(`SET SESSION max_statement_time = ${String(this.serverMs / 1_000)}`);
    }
  }

  /** Hand a connection back, or close it when it may be in mid-statement, or a stop may still reach it. */
  private finish({ connection, lost, stopped }: Connection): void {
    if (lost || stopped) connection.destroy();
    else connection.release();
  }

  private async answered(on: Connection, sql: string, params: readonly unknown[]): Promise<QueryResult> {
    if (on.lost) throw new Error('The MySQL connection was lost');
    try {
      return await run(on.connection, sql, params, this.timeoutMs);
    } catch (err) {
      if (!isBroken(err)) throw err;
      on.lost = true;
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`${reason}; the server gave no answer, so the statement may still take effect`, { cause: err });
    }
  }

  /**
   * The client timeout alone does not stop a statement: it would commit after the client gave up,
   * and the queue's retry would write the row twice. So the server is told to stop it, and its
   * answer, stopped or done, is the result. Without an answer the error says so.
   */
  private async statement(on: Connection, sql: string, params: readonly unknown[]): Promise<QueryResult> {
    let ended = false;
    let stopping: Promise<void> = Promise.resolve();
    const timer = setTimeout(() => {
      stopping = this.stop(on, () => ended);
    }, this.serverMs);
    try {
      return await this.answered(on, sql, params);
    } finally {
      ended = true;
      clearTimeout(timer);
      // A stop still on its way could reach the next statement, or the COMMIT.
      if (!(await settleWithin(stopping, SERVER_MARGIN_MS))) on.lost = true;
    }
  }

  /**
   * On a connection of its own: all of the pool's may be waiting. Never rejects: the statement's own
   * answer, or none, is reported.
   */
  private async stop(on: Connection, ended: () => boolean): Promise<void> {
    const { id, server } = on.session;
    if (id === null) return;
    try {
      const connection = await mysql.createConnection({ ...this.options, connectTimeout: SERVER_MARGIN_MS });
      try {
        const here = await serverSession(connection, SERVER_MARGIN_MS);
        if (here.server !== server || ended()) return;
        on.stopped = true;
        await run(connection, `KILL QUERY ${String(id)}`, [], SERVER_MARGIN_MS);
      } finally {
        connection.destroy();
      }
    } catch {
      // Not stopped, which the client timeout reports, or not yet.
      if (on.stopped) on.lost = true;
    }
  }

  private track<T>(work: Promise<T>): Promise<T> {
    const { inUse } = this;
    inUse.add(work);
    const ended = (): void => { inUse.delete(work); };
    work.then(ended, ended);
    return work;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Result<QueryResult>> {
    return tryCatch(() => this.track(this.runQuery(sql, params)));
  }

  private async runQuery(sql: string, params: readonly unknown[]): Promise<QueryResult> {
    const on = await this.connection();
    try {
      return await this.statement(on, sql, params);
    } finally {
      this.finish(on);
    }
  }

  async transaction<T>(fn: (tx: TxQuery) => Promise<T>): Promise<Result<T>> {
    return tryCatch(() => this.track(this.runTransaction('START TRANSACTION', fn)));
  }

  async queryReadOnly(sql: string, params: readonly unknown[]): Promise<Result<QueryResult>> {
    return tryCatch(() => this.track(this.runTransaction('START TRANSACTION READ ONLY', (tx) => tx.query(sql, params))));
  }

  /**
   * COMMIT included, every statement has the client timeout: a connection that drops during COMMIT must fail
   * the poll, not hang it. COMMIT is not stopped: one that is may have been replicated already.
   */
  private async runTransaction<T>(begin: string, fn: (tx: TxQuery) => Promise<T>): Promise<T> {
    const on = await this.connection();
    try {
      await this.answered(on, begin, []);
      const value = await fn({ query: (sql, params) => this.statement(on, sql, params) });
      await this.answered(on, 'COMMIT', []);
      return value;
    } catch (err) {
      // A connection the rollback could not reach is closed, never reused mid-transaction.
      if (!on.lost) await this.answered(on, 'ROLLBACK', []).catch(() => { on.lost = true; });
      throw err;
    } finally {
      this.finish(on);
    }
  }

  /** As pg's pool does, waits for what is in use: mysql2's would close a connection in mid-transaction. */
  async destroy(): Promise<Result<void>> {
    return tryCatch(async () => {
      const { pool, inUse } = this;
      if (!pool) return;
      this.pool = null;
      while (inUse.size > 0) await Promise.allSettled(inUse);
      await pool.end();
    });
  }
}
