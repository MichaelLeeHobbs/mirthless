// ===========================================
// Database Receiver (Source Connector)
// ===========================================
// Polls a database table with a SELECT query,
// dispatches each row as a message, and optionally
// executes an UPDATE to mark rows as processed.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { ConnectionPool, type PoolConfig, type TxQuery } from './connection-pool.js';
import { prepare } from './query-builder.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';

// ----- Constants -----

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

// ----- Config -----

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
}

export { UPDATE_MODE, ROW_FORMAT };
export type { UpdateMode, RowFormat };

// ----- Default Pool Config -----

function toPoolConfig(config: DatabaseReceiverConfig): PoolConfig {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    maxConnections: 5,
    idleTimeoutMs: 30_000,
    connectionTimeoutMs: 10_000,
    statementTimeoutMs: 30_000,
  };
}

/**
 * Append `FOR UPDATE SKIP LOCKED` to a SELECT so the claiming transaction locks
 * the rows it reads and concurrent pollers skip them. Left unchanged when the
 * query already carries an explicit locking clause. A trailing semicolon is
 * stripped so the appended clause is syntactically valid.
 *
 * The row-locking guarantee holds for a plain, lockable SELECT (single table,
 * no GROUP BY/DISTINCT/aggregate). If the query is not lockable PostgreSQL
 * rejects it and the failure surfaces loudly (logged) rather than silently
 * reopening the double-processing window.
 */
export function appendLockClause(selectQuery: string): string {
  const trimmed = selectQuery.trim().replace(/;\s*$/, '');
  if (/\bfor\s+(update|share)\b/i.test(trimmed)) return trimmed;
  return `${trimmed} FOR UPDATE SKIP LOCKED`;
}

// ----- Receiver -----

export class DatabaseReceiver implements SourceConnectorRuntime {
  private readonly config: DatabaseReceiverConfig;
  private readonly pool: ConnectionPool;
  private readonly logger: ConnectorLogger;
  private dispatcher: MessageDispatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(config: DatabaseReceiverConfig, pool?: ConnectionPool, logger?: ConnectorLogger) {
    this.config = config;
    this.pool = pool ?? new ConnectionPool();
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

      const createResult = await this.pool.create(toPoolConfig(this.config));
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

  /** Execute one poll cycle. Delegates to the atomic-claim path when acking. */
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

  /**
   * NEVER mode: no mark-as-processed exists, so there is nothing to lock or ack.
   * SELECT and dispatch each row; the query's own WHERE must exclude already
   * processed rows.
   */
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
    for (const row of queryResult.value.rows) {
      await this.dispatchRow(row);
    }
  }

  /**
   * ALWAYS / ON_SUCCESS mode: claim rows atomically. A single transaction runs
   * `SELECT ... FOR UPDATE SKIP LOCKED`, dispatches each row, then acks it — all
   * while holding the row locks, so a second poller (or a second engine
   * instance) cannot select the same rows and double-process them. The locks
   * release on COMMIT.
   *
   * Semantics: at-least-once. Rows are acked only after a successful dispatch
   * (ON_SUCCESS) or unconditionally (ALWAYS); an unacked row is re-selected next
   * cycle. A crash mid-transaction rolls back (no ack persisted) so the row is
   * retried — a message is never silently lost. The only duplication window is a
   * crash after dispatch but before COMMIT, inherent to any at-least-once claim.
   */
  private async pollWithClaim(): Promise<void> {
    const lockedSelect = appendLockClause(this.config.selectQuery);
    const txResult = await this.pool.transaction(async (tx) => {
      const selectResult = await tx.query(lockedSelect, []);
      for (const row of selectResult.rows) {
        const dispatchOk = await this.dispatchRow(row);
        await this.ackRow(tx, row, dispatchOk);
      }
    });
    if (!txResult.ok) {
      // SELECT/lock failure or a broken connection during the transaction.
      this.logger.error(
        { ...errorInfo(txResult.error), database: this.config.database },
        'Database poll transaction failed',
      );
    }
  }

  /** Dispatch a single row as a JSON message. Returns whether dispatch succeeded. */
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
    return result.ok;
  }

  /** Ack a claimed row inside the transaction per the configured update mode. */
  private async ackRow(
    tx: TxQuery,
    row: Readonly<Record<string, unknown>>,
    dispatchOk: boolean,
  ): Promise<void> {
    if (this.config.updateMode === UPDATE_MODE.ON_SUCCESS && !dispatchOk) return;

    const prepared = prepare(this.config.updateQuery, row as Record<string, unknown>);
    try {
      await tx.query(prepared.sql, prepared.params);
    } catch (err) {
      // Swallow a single row's ack failure so the rest of the batch still
      // commits (avoids rolling back — and thus re-dispatching — rows that
      // already succeeded). The row stays unprocessed and retries next cycle.
      this.logger.error(errorInfo(err), 'Database mark-as-processed UPDATE failed');
    }
  }

  /** Clear the poll interval timer. */
  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Drain the connection pool. */
  private async drainPool(): Promise<void> {
    const destroyResult = await this.pool.destroy();
    if (!destroyResult.ok) {
      // Pool destruction failure is non-fatal during stop
    }
  }
}
