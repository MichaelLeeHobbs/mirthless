// ===========================================
// Data Source Service
// ===========================================
// CRUD for database connection profiles + the query path behind the dbQuery
// script bridge. Passwords are encrypted at rest and never returned. All methods
// return Result<T>. See docs/design/11-datasources.md.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, asc } from 'drizzle-orm';
import type { CreateDataSourceInput, UpdateDataSourceInput } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { dataSources } from '../db/schema/index.js';
import { encryptContent, decryptContent, isContentEncryptionConfigured } from '../lib/content-crypto.js';
import { dataSourcePoolManager, type PooledDataSource } from './data-source-pool-manager.js';

// ----- Response Types (never include the password) -----

export interface DataSourceSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly driver: string;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly readOnly: boolean;
  readonly maxConnections: number;
  readonly statementTimeoutMs: number;
  readonly maxRows: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Connection fields for a test (unsaved form values). */
export interface TestConnectionInput {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

// ----- Helpers -----

function toSummary(row: typeof dataSources.$inferSelect): DataSourceSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    driver: row.driver,
    host: row.host,
    port: row.port,
    database: row.database,
    user: row.dbUser,
    readOnly: row.readOnly,
    maxConnections: row.maxConnections,
    statementTimeoutMs: row.statementTimeoutMs,
    maxRows: row.maxRows,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Encrypt a credential, refusing to store plaintext when no key is configured (fail loud). */
function encryptPassword(password: string): string {
  if (!isContentEncryptionConfigured()) {
    throw new ServiceError('CONFIG_ERROR', 'CONTENT_ENCRYPTION_KEY must be configured to store data source credentials');
  }
  const enc = encryptContent(password);
  if (!enc.ok) throw new ServiceError('CONFIG_ERROR', `Failed to encrypt data source password: ${enc.error.message}`);
  return enc.value;
}

// ----- Service -----

export class DataSourceService {
  static async list(): Promise<Result<readonly DataSourceSummary[]>> {
    return tryCatch(async () => {
      const rows = await db.select().from(dataSources).orderBy(asc(dataSources.name));
      return rows.map(toSummary);
    });
  }

  static async getById(id: string): Promise<Result<DataSourceSummary>> {
    return tryCatch(async () => {
      const [row] = await db.select().from(dataSources).where(eq(dataSources.id, id));
      if (!row) throw new ServiceError('NOT_FOUND', `Data source ${id} not found`);
      return toSummary(row);
    });
  }

  static async create(input: CreateDataSourceInput, context?: AuditContext): Promise<Result<DataSourceSummary>> {
    return tryCatch(async () => {
      const [existing] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.name, input.name));
      if (existing) throw new ServiceError('ALREADY_EXISTS', `Data source "${input.name}" already exists`);

      // Encrypt before touching the DB so a missing key fails loud without a row.
      const passwordEncrypted = encryptPassword(input.password);
      const [row] = await db
        .insert(dataSources)
        .values({
          name: input.name,
          description: input.description,
          driver: input.driver,
          host: input.host,
          port: input.port,
          database: input.database,
          dbUser: input.user,
          passwordEncrypted,
          readOnly: input.readOnly,
          maxConnections: input.maxConnections,
          statementTimeoutMs: input.statementTimeoutMs,
          maxRows: input.maxRows,
        })
        .returning();

      emitDataSourceEvent(context, { action: 'create', dataSourceName: input.name });
      return toSummary(row!);
    });
  }

  static async update(id: string, input: UpdateDataSourceInput, context?: AuditContext): Promise<Result<DataSourceSummary>> {
    return tryCatch(async () => {
      const [existing] = await db.select().from(dataSources).where(eq(dataSources.id, id));
      if (!existing) throw new ServiceError('NOT_FOUND', `Data source ${id} not found`);

      if (input.name && input.name !== existing.name) {
        const [dup] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.name, input.name));
        if (dup) throw new ServiceError('ALREADY_EXISTS', `Data source "${input.name}" already exists`);
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updates['name'] = input.name;
      if (input.description !== undefined) updates['description'] = input.description;
      if (input.host !== undefined) updates['host'] = input.host;
      if (input.port !== undefined) updates['port'] = input.port;
      if (input.database !== undefined) updates['database'] = input.database;
      if (input.user !== undefined) updates['dbUser'] = input.user;
      if (input.password !== undefined) updates['passwordEncrypted'] = encryptPassword(input.password);
      if (input.readOnly !== undefined) updates['readOnly'] = input.readOnly;
      if (input.maxConnections !== undefined) updates['maxConnections'] = input.maxConnections;
      if (input.statementTimeoutMs !== undefined) updates['statementTimeoutMs'] = input.statementTimeoutMs;
      if (input.maxRows !== undefined) updates['maxRows'] = input.maxRows;

      const [row] = await db.update(dataSources).set(updates).where(eq(dataSources.id, id)).returning();
      // Config may have changed — drop the cached pool so the next query rebuilds it.
      await dataSourcePoolManager.invalidate(id);
      emitDataSourceEvent(context, { action: 'update', dataSourceId: id });
      return toSummary(row!);
    });
  }

  static async delete(id: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.id, id));
      if (!existing) throw new ServiceError('NOT_FOUND', `Data source ${id} not found`);
      await db.delete(dataSources).where(eq(dataSources.id, id));
      await dataSourcePoolManager.invalidate(id);
      emitDataSourceEvent(context, { action: 'delete', dataSourceId: id });
    });
  }

  /** Run a parameterized query against a data source (by name). Called by the dbQuery bridge. */
  static async runQuery(name: string, sql: string, params: readonly unknown[]): Promise<Result<readonly Record<string, unknown>[]>> {
    return tryCatch(async () => {
      const [row] = await db.select().from(dataSources).where(eq(dataSources.name, name));
      if (!row) throw new ServiceError('NOT_FOUND', `Data source "${name}" not found`);
      const pw = decryptContent(row.passwordEncrypted);
      if (!pw.ok) throw new ServiceError('CONFIG_ERROR', `Failed to decrypt data source credentials: ${pw.error.message}`);
      const resolved: PooledDataSource = {
        id: row.id,
        host: row.host,
        port: row.port,
        database: row.database,
        user: row.dbUser,
        password: pw.value,
        readOnly: row.readOnly,
        maxConnections: row.maxConnections,
        statementTimeoutMs: row.statementTimeoutMs,
        maxRows: row.maxRows,
      };
      return dataSourcePoolManager.runQuery(resolved, sql, params);
    });
  }

  /** Test connectivity for unsaved form values (throwaway pool, no caching). */
  static async testConnection(input: TestConnectionInput): Promise<Result<void>> {
    const { ConnectionPool } = await import('@mirthless/connectors');
    return tryCatch(async () => {
      const pool = new ConnectionPool();
      const created = await pool.create({
        host: input.host,
        port: input.port,
        database: input.database,
        user: input.user,
        password: input.password,
        maxConnections: 1,
        idleTimeoutMs: 5_000,
        connectionTimeoutMs: 8_000,
        statementTimeoutMs: 8_000,
      });
      try {
        if (!created.ok) throw new Error(created.error.message);
      } finally {
        await pool.destroy();
      }
    });
  }
}

function emitDataSourceEvent(context: AuditContext | undefined, attributes: Record<string, unknown>): void {
  emitEvent({
    level: 'INFO', name: 'DATASOURCE_UPDATED', outcome: 'SUCCESS',
    userId: context?.userId ?? null, channelId: null,
    serverId: null, ipAddress: context?.ipAddress ?? null,
    attributes,
  });
}
