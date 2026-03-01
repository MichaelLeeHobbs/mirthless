// ===========================================
// Database Receiver (Source Connector)
// ===========================================
// Polls a database table with a SELECT query,
// dispatches each row as a message, and optionally
// executes an UPDATE to mark rows as processed.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { ConnectionPool, type PoolConfig } from './connection-pool.js';
import { prepare } from './query-builder.js';

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
  };
}

// ----- Receiver -----

export class DatabaseReceiver implements SourceConnectorRuntime {
  private readonly config: DatabaseReceiverConfig;
  private readonly pool: ConnectionPool;
  private dispatcher: MessageDispatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(config: DatabaseReceiverConfig, pool?: ConnectionPool) {
    this.config = config;
    this.pool = pool ?? new ConnectionPool();
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

  /** Execute one poll cycle: SELECT rows, dispatch each, optionally UPDATE. */
  private async pollCycle(): Promise<void> {
    if (this.polling || !this.dispatcher) return;
    this.polling = true;
    try {
      const queryResult = await this.pool.query(this.config.selectQuery, []);
      if (!queryResult.ok) return;

      for (const row of queryResult.value.rows) {
        await this.processRow(row);
      }
    } finally {
      this.polling = false;
    }
  }

  /** Dispatch a single row as a message and apply update if configured. */
  private async processRow(row: Readonly<Record<string, unknown>>): Promise<void> {
    if (!this.dispatcher) return;

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
    await this.executeUpdate(row, result.ok);
  }

  /** Execute the update query if the update mode requires it. */
  private async executeUpdate(
    row: Readonly<Record<string, unknown>>,
    dispatchOk: boolean,
  ): Promise<void> {
    if (this.config.updateMode === UPDATE_MODE.NEVER) return;
    if (this.config.updateMode === UPDATE_MODE.ON_SUCCESS && !dispatchOk) return;

    const prepared = prepare(this.config.updateQuery, row as Record<string, unknown>);
    await this.pool.query(prepared.sql, prepared.params);
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
