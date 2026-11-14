// ===========================================
// Database Dispatcher (Destination Connector)
// ===========================================
// Executes parameterized INSERT/UPDATE queries
// against a PostgreSQL or MySQL database.

import { tryCatch, type Result } from '@galvaniflow/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import type { DatabasePool, PoolConfig } from './connection-pool.js';
import { prepare, type PreparedQuery } from './query-builder.js';
import { DATABASE_VENDOR, createPool, placeholderStyle, type DatabaseVendor } from './database-vendor.js';

// ----- Config -----

export interface DatabaseDispatcherConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly username: string;
  readonly password: string;
  readonly query: string;
  readonly useTransaction: boolean;
  readonly returnGeneratedKeys: boolean;
  /** Connect with TLS and verify the server certificate. */
  readonly tls?: boolean;
  /** The database it talks to (default PostgreSQL). */
  readonly vendor?: DatabaseVendor;
}

// ----- Default Pool Config -----

function toPoolConfig(config: DatabaseDispatcherConfig): PoolConfig {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    maxConnections: 5,
    idleTimeoutMs: 30_000,
    connectionTimeoutMs: 10_000,
    tls: config.tls === true,
  };
}

// ----- Dispatcher -----

export class DatabaseDispatcher implements DestinationConnectorRuntime {
  private readonly config: DatabaseDispatcherConfig;
  private readonly pool: DatabasePool;
  private started = false;

  constructor(config: DatabaseDispatcherConfig, pool?: DatabasePool) {
    this.config = config;
    this.pool = pool ?? createPool(config.vendor ?? DATABASE_VENDOR.POSTGRESQL);
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.host) {
        throw new Error('Host is required');
      }
      if (!this.config.database) {
        throw new Error('Database name is required');
      }
      if (!this.config.query) {
        throw new Error('Query is required');
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      const createResult = await this.pool.create(toPoolConfig(this.config));
      if (!createResult.ok) {
        throw createResult.error;
      }
      this.started = true;
    });
  }

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    if (!this.started) {
      return tryCatch(async () => {
        throw new Error('Dispatcher not started');
      });
    }
    if (signal.aborted) {
      return tryCatch(async () => {
        throw new Error('Send aborted');
      });
    }

    if (this.config.useTransaction) {
      return this.sendWithTransaction(message);
    }
    return this.sendDirect(message);
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
      await this.drainPool();
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
      await this.drainPool();
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }

  /** The query with the message's values as parameters, in the vendor's placeholder style. */
  private prepared(message: ConnectorMessage): PreparedQuery {
    return prepare(this.config.query, this.buildContext(message), placeholderStyle(this.config.vendor ?? DATABASE_VENDOR.POSTGRESQL));
  }

  private response(rows: readonly Record<string, unknown>[], rowCount: number): ConnectorResponse {
    const content = this.config.returnGeneratedKeys ? JSON.stringify(rows) : String(rowCount);
    return { status: 'SENT' as const, content };
  }

  /** Execute query directly (no transaction). */
  private async sendDirect(message: ConnectorMessage): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      const prepared = this.prepared(message);
      const result = await this.pool.query(prepared.sql, prepared.params);
      if (!result.ok) {
        throw result.error;
      }
      return this.response(result.value.rows, result.value.rowCount);
    });
  }

  /** Execute query inside a transaction, rolled back if it fails. */
  private async sendWithTransaction(message: ConnectorMessage): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      const prepared = this.prepared(message);
      const result = await this.pool.transaction((tx) => tx.query(prepared.sql, prepared.params));
      if (!result.ok) {
        throw result.error;
      }
      return this.response(result.value.rows, result.value.rowCount);
    });
  }

  /**
   * Values for the query's `${name}` parameters: the message's map variables,
   * then the fields of a JSON message (which win over a variable of the same
   * name), then the message's own ids and content.
   */
  private buildContext(message: ConnectorMessage): Record<string, unknown> {
    // Parse message content as JSON if possible, otherwise use raw content
    let parsed: Record<string, unknown> = {};
    try {
      const json: unknown = JSON.parse(message.content);
      if (json !== null && typeof json === 'object' && !Array.isArray(json)) {
        parsed = json as Record<string, unknown>;
      }
    } catch {
      // Not JSON — use raw content
    }

    return {
      ...(message.variables ?? {}),
      ...parsed,
      messageId: message.messageId,
      channelId: message.channelId,
      metaDataId: message.metaDataId,
      content: message.content,
      dataType: message.dataType,
    };
  }

  /** Drain the connection pool. */
  private async drainPool(): Promise<void> {
    const destroyResult = await this.pool.destroy();
    if (!destroyResult.ok) {
      // Pool destruction failure is non-fatal during stop
    }
  }
}
