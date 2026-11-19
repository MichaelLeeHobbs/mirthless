import { tryCatch, type Result } from '@galvanigraph/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { dispatchFailure } from '../base.js';
import { toPoolConfig, type DatabasePool, type TxQuery } from './connection-pool.js';
import { prepare } from './query-builder.js';
import { DATABASE_VENDOR, createPool, placeholderStyle, type DatabaseVendor } from './database-vendor.js';
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

/**
 * Locks hold only for a plain SELECT (one table, no GROUP BY/DISTINCT/aggregate). PostgreSQL
 * rejects any other with this clause, and the failure is logged rather than reopening double
 * processing.
 */
export function appendLockClause(selectQuery: string): string {
  const trimmed = selectQuery.trim().replace(/;\s*$/, '');
  if (/\bfor\s+(update|share)\b/i.test(trimmed)) return trimmed;
  return `${trimmed} FOR UPDATE SKIP LOCKED`;
}

export class DatabaseReceiver implements SourceConnectorRuntime {
  private readonly config: DatabaseReceiverConfig;
  private readonly pool: DatabasePool;
  private readonly logger: ConnectorLogger;
  private dispatcher: MessageDispatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(config: DatabaseReceiverConfig, pool?: DatabasePool, logger?: ConnectorLogger) {
    this.config = config;
    this.pool = pool ?? createPool(config.vendor ?? DATABASE_VENDOR.POSTGRESQL);
    this.logger = logger ?? createConnectorLogger('DATABASE');
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
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
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }

      const createResult = await this.pool.create(toPoolConfig(this.config, STATEMENT_TIMEOUT_MS));
      if (!createResult.ok) {
        throw createResult.error;
      }

      this.pollTimer = setInterval(() => {
        void this.pollCycle();
      }, this.config.pollingIntervalMs);
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.clearPollTimer();
      await this.drainPool();
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.clearPollTimer();
      await this.drainPool();
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.dispatcher = null;
    });
  }

  private async pollCycle(): Promise<void> {
    if (this.polling || !this.dispatcher) return;
    this.polling = true;
    try {
      if (this.config.updateMode === UPDATE_MODE.NEVER) {
        await this.pollNoAck();
      } else {
        await this.pollWithClaim();
      }
    } catch (err) {
      this.logger.error(
        { ...errorInfo(err), database: this.config.database },
        'Database poll cycle failed',
      );
    } finally {
      this.polling = false;
    }
  }

  /** Nothing to lock or ack: the query's own WHERE must exclude processed rows. */
  private async pollNoAck(): Promise<void> {
    const queryResult = await this.pool.query(this.config.selectQuery, []);
    if (!queryResult.ok) {
      // Expired credentials / dropped connection otherwise leave the channel
      // STARTED yet silently idle — surface it loudly.
      this.logger.error(
        { ...errorInfo(queryResult.error), database: this.config.database },
        'Database poll SELECT failed',
      );
      return;
    }
    for (const row of this.capRows(queryResult.value.rows)) {
      await this.dispatchRow(row);
    }
  }

  /**
   * Dispatch and ack happen while holding the row locks, so a second poller or engine cannot
   * double-process. At-least-once: a crash after dispatch but before COMMIT delivers the row again.
   */
  private async pollWithClaim(): Promise<void> {
    const lockedSelect = appendLockClause(this.config.selectQuery);
    const dispatched: Array<{ row: Readonly<Record<string, unknown>>; recorded: boolean }> = [];
    const txResult = await this.pool.transaction(async (tx) => {
      const selectResult = await tx.query(lockedSelect, []);
      for (const row of this.capRows(selectResult.rows)) {
        const recorded = await this.dispatchRow(row);
        dispatched.push({ row, recorded });
        await this.ackRow(tx, row, recorded);
      }
    });
    if (txResult.ok) return;
    // SELECT/lock failure, a broken connection, or (MySQL) a deadlock, which
    // rolls back the whole transaction and with it every ack of this poll.
    this.logger.error(
      { ...errorInfo(txResult.error), database: this.config.database, dispatched: dispatched.length },
      'Database poll transaction failed',
    );
    if (dispatched.length > 0) await this.reackDispatched(dispatched);
  }

  /** Without dispatching again: read again next poll, these rows would become duplicate messages. */
  private async reackDispatched(dispatched: ReadonlyArray<{ row: Readonly<Record<string, unknown>>; recorded: boolean }>): Promise<void> {
    const retry = await this.pool.transaction(async (tx) => {
      for (const { row, recorded } of dispatched) await this.ackRow(tx, row, recorded);
    });
    if (!retry.ok) {
      this.logger.error(
        { ...errorInfo(retry.error), database: this.config.database, rows: dispatched.length },
        'Rows were dispatched but could not be marked processed; the next poll reads and dispatches them again',
      );
    }
  }

  /**
   * Whether the pipeline RECORDED the message, which decides the ack. One recorded with an ERROR
   * status can be reprocessed from the store; leaving its row unacked would deliver it again to
   * every healthy destination on every poll.
   */
  private async dispatchRow(row: Readonly<Record<string, unknown>>): Promise<boolean> {
    if (!this.dispatcher) return false;

    const content = JSON.stringify(row);
    const raw: RawMessage = {
      content,
      sourceMap: {
        database: this.config.database,
        host: this.config.host,
        port: this.config.port,
        rowData: row,
      },
    };

    const result = await this.dispatcher(raw);
    const failure = dispatchFailure(result);
    if (failure !== null) {
      this.logger.error(errorInfo(failure), 'Database row dispatch failed');
    }
    return result.ok;
  }

  private async ackRow(
    tx: TxQuery,
    row: Readonly<Record<string, unknown>>,
    recorded: boolean,
  ): Promise<void> {
    if (this.config.updateMode === UPDATE_MODE.ON_SUCCESS && !recorded) return;

    const prepared = prepare(this.config.updateQuery, row as Record<string, unknown>, placeholderStyle(this.config.vendor ?? DATABASE_VENDOR.POSTGRESQL));
    // A failed statement aborts a PostgreSQL transaction, and COMMIT then rolls back the acks
    // of rows already dispatched. The savepoint confines the failure to this row.
    await tx.query('SAVEPOINT ack_row', []);
    try {
      await tx.query(prepared.sql, prepared.params);
      await tx.query('RELEASE SAVEPOINT ack_row', []);
    } catch (err) {
      this.logger.error(errorInfo(err), 'Database mark-as-processed UPDATE failed');
      await tx.query('ROLLBACK TO SAVEPOINT ack_row', []);
    }
  }

  /** Bounds how long row locks are held; the rest are read again next cycle. */
  private capRows(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
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

  private async drainPool(): Promise<void> {
    const destroyResult = await this.pool.destroy();
    if (!destroyResult.ok) {
      // Pool destruction failure is non-fatal during stop
    }
  }
}
