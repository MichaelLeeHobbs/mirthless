// ===========================================
// Database Dispatcher (Destination Connector)
// ===========================================
// Executes parameterized INSERT/UPDATE queries
// against a PostgreSQL database.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import { ConnectionPool, type PoolConfig } from './connection-pool.js';
import { prepare } from './query-builder.js';

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
  };
}

// ----- Dispatcher -----

export class DatabaseDispatcher implements DestinationConnectorRuntime {
  private readonly config: DatabaseDispatcherConfig;
  private readonly pool: ConnectionPool;
  private started = false;

  constructor(config: DatabaseDispatcherConfig, pool?: ConnectionPool) {
    this.config = config;
    this.pool = pool ?? new ConnectionPool();
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

  /** Execute query directly (no transaction). */
  private async sendDirect(message: ConnectorMessage): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      const context = this.buildContext(message);
      const prepared = prepare(this.config.query, context);
      const result = await this.pool.query(prepared.sql, prepared.params);

      if (!result.ok) {
        throw result.error;
      }

      const content = this.config.returnGeneratedKeys
        ? JSON.stringify(result.value.rows)
        : String(result.value.rowCount);

      return { status: 'SENT' as const, content };
    });
  }

  /** Execute query inside a transaction. */
  private async sendWithTransaction(message: ConnectorMessage): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      const clientResult = await this.pool.acquireClient();
      if (!clientResult.ok) {
        throw clientResult.error;
      }

      const client = clientResult.value;
      try {
        await client.query('BEGIN');

        const context = this.buildContext(message);
        const prepared = prepare(this.config.query, context);
        const result = await client.query(prepared.sql, [...prepared.params]);

        await client.query('COMMIT');

        const content = this.config.returnGeneratedKeys
          ? JSON.stringify(result.rows)
          : String(result.rowCount ?? 0);

        return { status: 'SENT' as const, content };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });
  }

  /** Build a context object from a ConnectorMessage for template substitution. */
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
