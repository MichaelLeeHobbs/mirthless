import { stderr, tryCatch, type Result } from '@galvanigraph/core-util';
import type { SourceConnectorRuntime, SourceHealthHandler, MessageDispatcher, RawMessage } from '../base.js';
import { dispatchFailure } from '../base.js';
import { toPoolConfig, type DatabasePool, type TxQuery } from './connection-pool.js';
import { appendLockClause, unheldRowsReason, withSkippedRows } from './lock-clause.js';
import { prepare } from './query-builder.js';
import { DATABASE_VENDOR, createPool, placeholderStyle, type DatabaseVendor } from './database-vendor.js';
import { UnmarkedRows, rowKey, type Row, type TakenRow } from './unmarked-rows.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';

const UPDATE_MODE = {
  NEVER: 'NEVER',
  ALWAYS: 'ALWAYS',
  ON_SUCCESS: 'ON_SUCCESS',
} as const;
type UpdateMode = typeof UPDATE_MODE[keyof typeof UPDATE_MODE];

const ROW_FORMAT = {
  JSON: 'JSON',
} as const;
type RowFormat = typeof ROW_FORMAT[keyof typeof ROW_FORMAT];

export const MAX_ROWS_PER_POLL = 1_000;

export interface DatabaseReceiverConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly username: string;
  readonly password: string;
  readonly selectQuery: string;
  readonly updateQuery: string;
  readonly updateMode: UpdateMode;
  readonly pollingIntervalMs: number;
  readonly rowFormat: RowFormat;
  readonly tls?: boolean;
  /** Default PostgreSQL. */
  readonly vendor?: DatabaseVendor;
}

export { UPDATE_MODE, ROW_FORMAT };
export type { UpdateMode, RowFormat };

const STATEMENT_TIMEOUT_MS = 30_000;

/** PostgreSQL's and MySQL's code for a write in a read-only transaction. */
function isWriteRefused(error: Error): boolean {
  const { code } = error as { readonly code?: unknown };
  return code === '25006' || code === 'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION';
}

/** For an alert: a database's text can quote a value of a row. */
function withoutText(error: Error): Error {
  const { code } = error as { readonly code?: unknown };
  return typeof code === 'string' ? new Error(`The database failed with ${code}; the server log has its text`) : error;
}

/** One start of the source. A cycle that outlives a halt keeps its own pool, not a later start's. */
interface Session {
  readonly pool: DatabasePool;
  readonly dispatcher: MessageDispatcher;
  /** False once stop or halt is asked for: the cycle in flight takes no more rows. */
  live: boolean;
}

interface PolledRow {
  readonly row: Row;
  readonly content: string;
}

export class DatabaseReceiver implements SourceConnectorRuntime {
  private readonly config: DatabaseReceiverConfig;
  private readonly openPool: () => DatabasePool;
  private readonly logger: ConnectorLogger;
  private dispatcher: MessageDispatcher | null = null;
  private health: SourceHealthHandler = () => undefined;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private session: Session | null = null;
  /** The poll cycle in flight, of this session or of one that was halted; there is never a second. */
  private cycle: { readonly session: Session; readonly ended: Promise<void> } | null = null;
  private readonly unmarked = new UnmarkedRows();
  private readonly claimQuery: string;

  constructor(config: DatabaseReceiverConfig, pool?: DatabasePool, logger?: ConnectorLogger) {
    this.config = config;
    this.openPool = (): DatabasePool => pool ?? createPool(this.vendor);
    this.claimQuery = appendLockClause(config.selectQuery, this.vendor);
    this.logger = logger ?? createConnectorLogger('DATABASE');
  }

  private get vendor(): DatabaseVendor {
    return this.config.vendor ?? DATABASE_VENDOR.POSTGRESQL;
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  setHealthHandler(handler: SourceHealthHandler): void {
    this.health = handler;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.host) {
        throw new Error('Host is required');
      }
      if (!this.config.database) {
        throw new Error('Database name is required');
      }
      if (!this.config.selectQuery) {
        throw new Error('SELECT query is required');
      }
      if (this.config.pollingIntervalMs < 100) {
        throw new Error('Polling interval must be at least 100ms');
      }
      if (this.config.updateMode !== UPDATE_MODE.NEVER && !this.config.updateQuery) {
        throw new Error('Update query is required when updateMode is not NEVER');
      }
      this.warnIfRowsUnheld();
    });
  }

  /**
   * A warning, not a refusal (#445): one source alone takes no row twice, and channels run today on
   * such queries. The query is not logged: it can hold values of rows.
   */
  private warnIfRowsUnheld(): void {
    if (this.config.updateMode === UPDATE_MODE.NEVER) return;
    const why = unheldRowsReason(this.config.selectQuery, this.vendor);
    if (why === null) return;
    this.logger.warn(
      { database: this.config.database, why },
      'The SELECT query\'s lock may hold none of the rows it returns, so two sources on the same table can take the same row. Give the query that reads the rows a FOR UPDATE SKIP LOCKED of its own',
    );
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }
      const session: Session = { pool: this.openPool(), dispatcher: this.dispatcher, live: true };

      const createResult = await session.pool.create(toPoolConfig(this.config, STATEMENT_TIMEOUT_MS));
      if (!createResult.ok) {
        throw createResult.error;
      }

      this.session = session;
      this.pollTimer = setInterval(() => {
        this.poll(session);
      }, this.config.pollingIntervalMs);
    });
  }

  /** Waits for the row being processed, so it is marked before its connection goes. */
  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      const session = this.endSession();
      const { cycle } = this;
      // Not only this session's: after a halt the session is gone, and its row may be in flight.
      if (cycle !== null) await cycle.ended;
      if (session !== null && session !== cycle?.session) await this.drainPool(session);
    });
  }

  /** Does not wait: the cycle in flight marks the row it dispatched, and closes its pool. */
  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      const session = this.endSession();
      if (session !== null && session !== this.cycle?.session) await this.drainPool(session);
    });
  }

  private endSession(): Session | null {
    const { session } = this;
    this.clearPollTimer();
    if (session !== null) session.live = false;
    this.session = null;
    return session;
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
    });
  }

  private poll(session: Session): void {
    if (this.cycle !== null) return;
    const ended = this.pollCycle(session).finally(async () => {
      this.cycle = null;
      if (!session.live) await this.drainPool(session);
    });
    this.cycle = { session, ended };
  }

  private async pollCycle(session: Session): Promise<void> {
    try {
      if (this.config.updateMode === UPDATE_MODE.NEVER) {
        await this.pollNoAck(session);
      } else {
        await this.pollWithClaim(session);
      }
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), database: this.config.database },
        'Database poll cycle failed',
      );
      this.reportHealth(session, stderr(err));
    }
  }

  private reportHealth(session: Session, failure: Error | null): void {
    if (session.live) this.health(failure === null ? null : withoutText(failure));
  }

  /** Nothing to lock or ack: the query's own WHERE must exclude processed rows. */
  private async pollNoAck(session: Session): Promise<void> {
    const queryResult = await session.pool.query(this.config.selectQuery, []);
    if (!queryResult.ok) {
      // Expired credentials / dropped connection otherwise leave the channel
      // STARTED yet silently idle — surface it loudly.
      this.logger.error(
        { ...errorInfo(queryResult.error), database: this.config.database },
        'Database poll SELECT failed',
      );
      this.reportHealth(session, queryResult.error);
      return;
    }
    this.reportHealth(session, null);
    for (const row of this.capRows(queryResult.value.rows)) {
      if (!session.live) return;
      await this.dispatchRow(session, { row, content: JSON.stringify(row) });
    }
  }

  /**
   * Dispatch and ack happen while holding the row locks, so a second poller or engine cannot
   * double-process. At-least-once: a crash after dispatch but before COMMIT delivers the row again.
   */
  private async pollWithClaim(session: Session): Promise<void> {
    const taken: TakenRow[] = [];
    const txResult = await session.pool.transaction(async (tx) => {
      const { rows } = await tx.query(this.claimQuery, []);
      await this.forgetGone(session, rows);
      await this.takeRows(session, tx, rows, taken);
    });
    if (!txResult.ok) {
      // SELECT/lock failure, a broken connection, or (MySQL) a deadlock, which
      // rolls back the whole transaction and with it every ack of this poll.
      this.logger.error(
        { ...errorInfo(txResult.error), database: this.config.database, dispatched: taken.length },
        'Database poll transaction failed',
      );
      this.reportHealth(session, txResult.error);
      if (taken.length > 0) await this.reack(session, taken);
    } else {
      this.reportHealth(session, null);
    }
    this.unmarked.settle(taken);
  }

  /**
   * A row that another transaction holds is missing too, and is not gone. Read-only, because the
   * query may be one that writes: the database refuses that one, and what it misses counts as gone.
   */
  private async forgetGone(session: Session, rows: readonly Row[]): Promise<void> {
    const claimed = this.unmarked.countIn(rows);
    if (!this.unmarked.hasMoreThan(claimed)) return;
    const query = withSkippedRows(this.claimQuery, this.vendor);
    if (query === this.claimQuery) {
      this.unmarked.keepOnly(claimed);
      return;
    }
    const all = await session.pool.queryReadOnly(query, []);
    if (all.ok) {
      this.unmarked.keepOnly(this.unmarked.countIn(all.value.rows));
    } else if (isWriteRefused(all.error)) {
      this.unmarked.keepOnly(claimed);
    } else {
      this.logger.error(
        { ...errorInfo(all.error), database: this.config.database },
        'Could not look for rows that were dispatched and not marked; they stay remembered, and are not dispatched again',
      );
    }
  }

  private async takeRows(session: Session, tx: TxQuery, rows: readonly Row[], taken: TakenRow[]): Promise<void> {
    const unmarked = this.unmarked.remaining();
    for (const row of this.capRows(rows)) {
      if (!session.live) return;
      const content = JSON.stringify(row);
      const key = rowKey(content);
      const left = unmarked.get(key) ?? 0;
      const known = left > 0;
      if (known) unmarked.set(key, left - 1);
      const recorded = known || await this.dispatchRow(session, { row, content });
      const entry: TakenRow = { row, key, recorded, known, marked: false };
      taken.push(entry);
      entry.marked = await this.ackRow(tx, entry);
    }
  }

  /** Without dispatching again, in a transaction of its own. */
  private async reack(session: Session, taken: readonly TakenRow[]): Promise<void> {
    for (const entry of taken) entry.marked = false;
    const retry = await session.pool.transaction(async (tx) => {
      for (const entry of taken) entry.marked = await this.ackRow(tx, entry);
    });
    if (retry.ok) return;
    for (const entry of taken) entry.marked = false;
    this.logger.error(
      { ...errorInfo(retry.error), database: this.config.database, rows: taken.length },
      'Rows were dispatched but could not be marked processed; each poll tries again, without dispatching a recorded row',
    );
  }

  /**
   * Whether the pipeline RECORDED the message, which decides the ack. One recorded with an ERROR
   * status can be reprocessed from the store; leaving its row unacked would deliver it again to
   * every healthy destination on every poll.
   */
  private async dispatchRow(session: Session, { row, content }: PolledRow): Promise<boolean> {
    const raw: RawMessage = {
      content,
      sourceMap: {
        database: this.config.database,
        host: this.config.host,
        port: this.config.port,
        rowData: row,
      },
    };

    const result = await session.dispatcher(raw);
    const failure = dispatchFailure(result);
    if (failure !== null) {
      this.logger.error(errorInfo(failure), 'Database row dispatch failed');
    }
    return result.ok;
  }

  /** Whether the row is marked processed. */
  private async ackRow(tx: TxQuery, { row, recorded }: TakenRow): Promise<boolean> {
    if (this.config.updateMode === UPDATE_MODE.ON_SUCCESS && !recorded) return false;

    const prepared = prepare(this.config.updateQuery, row, placeholderStyle(this.vendor));
    // A failed statement aborts a PostgreSQL transaction, and COMMIT then rolls back the acks
    // of rows already dispatched. The savepoint confines the failure to this row.
    await tx.query('SAVEPOINT ack_row', []);
    try {
      await tx.query(prepared.sql, prepared.params);
      await tx.query('RELEASE SAVEPOINT ack_row', []);
      return true;
    } catch (err) {
      this.logger.error(errorInfo(err), 'Database mark-as-processed UPDATE failed; each poll tries again, without dispatching a recorded row');
      await tx.query('ROLLBACK TO SAVEPOINT ack_row', []);
      return false;
    }
  }

  /** Bounds how long row locks are held; the rest are read again next cycle. */
  private capRows<T>(rows: readonly T[]): readonly T[] {
    if (rows.length <= MAX_ROWS_PER_POLL) return rows;
    this.logger.warn(
      { database: this.config.database, rows: rows.length, limit: MAX_ROWS_PER_POLL },
      'Database poll returned more rows than one poll processes; add a LIMIT to the SELECT query',
    );
    return rows.slice(0, MAX_ROWS_PER_POLL);
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async drainPool(session: Session): Promise<void> {
    const destroyResult = await session.pool.destroy();
    if (!destroyResult.ok) {
      // Pool destruction failure is non-fatal during stop
    }
  }
}
