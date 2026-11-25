import { tryCatch, type Result } from '@galvanigraph/core-util';
import { variableNames, type DestinationConnectorRuntime, type ConnectorMessage, type ConnectorResponse } from '../base.js';
import { toPoolConfig, type DatabasePool } from './connection-pool.js';
import { prepare, type PreparedQuery } from './query-builder.js';
import { DATABASE_VENDOR, createPool, placeholderStyle, type DatabaseVendor } from './database-vendor.js';

export interface DatabaseDispatcherConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly username: string;
  readonly password: string;
  readonly query: string;
  readonly useTransaction: boolean;
  readonly returnGeneratedKeys: boolean;
  readonly tls?: boolean;
  /** Default PostgreSQL. */
  readonly vendor?: DatabaseVendor;
}

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

  variablesUsed(message: ConnectorMessage): readonly string[] {
    const withoutVariables = this.buildContext({ ...message, variables: undefined });
    return variableNames([this.config.query]).filter((name) => !Object.hasOwn(withoutVariables, name));
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

    return this.execute(message, this.config.useTransaction);
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

  private prepared(message: ConnectorMessage): PreparedQuery {
    return prepare(this.config.query, this.buildContext(message), placeholderStyle(this.config.vendor ?? DATABASE_VENDOR.POSTGRESQL));
  }

  private response(rows: readonly Record<string, unknown>[], rowCount: number): ConnectorResponse {
    const content = this.config.returnGeneratedKeys ? JSON.stringify(rows) : String(rowCount);
    return { status: 'SENT' as const, content };
  }

  private async execute(message: ConnectorMessage, useTransaction: boolean): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      const { sql, params } = this.prepared(message);
      const result = useTransaction
        ? await this.pool.transaction((tx) => tx.query(sql, params))
        : await this.pool.query(sql, params);
      if (!result.ok) {
        throw result.error;
      }
      return this.response(result.value.rows, result.value.rowCount);
    });
  }

  private buildContext(message: ConnectorMessage): Record<string, unknown> {
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

  private async drainPool(): Promise<void> {
    const destroyResult = await this.pool.destroy();
    if (!destroyResult.ok) {
      // Pool destruction failure is non-fatal during stop
    }
  }
}
