// ===========================================
// Data Source Zod Schemas
// ===========================================
// A Data Source is an admin-managed database connection profile that channel
// scripts query via dbQuery(dataSourceName, sql, params). Credentials live
// server-side (encrypted at rest). See docs/design/11-datasources.md.

import { z } from 'zod/v4';

// ----- Driver -----

export const DB_DRIVER = {
  POSTGRES: 'postgres',
} as const;
export type DbDriver = (typeof DB_DRIVER)[keyof typeof DB_DRIVER];

// ----- Shared field constraints -----

const portSchema = z.number().int().min(1).max(65_535);
const maxConnectionsSchema = z.number().int().min(1).max(50);
const statementTimeoutSchema = z.number().int().min(100).max(600_000);
const maxRowsSchema = z.number().int().min(1).max(1_000_000);

// ----- Data Source CRUD -----

export const createDataSourceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().default(''),
  /** Only PostgreSQL is supported in v1. */
  driver: z.literal('postgres').default('postgres'),
  host: z.string().min(1).max(255),
  port: portSchema.default(5432),
  database: z.string().min(1).max(255),
  user: z.string().min(1).max(255),
  /** Plaintext on the wire (TLS); stored encrypted at rest. Required on create. */
  password: z.string(),
  /** Read-only unless explicitly set false (enforced by the DB role + read-only txn). */
  readOnly: z.boolean().default(true),
  maxConnections: maxConnectionsSchema.default(5),
  statementTimeoutMs: statementTimeoutSchema.default(30_000),
  maxRows: maxRowsSchema.default(10_000),
});

export type CreateDataSourceInput = z.infer<typeof createDataSourceSchema>;

export const updateDataSourceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  host: z.string().min(1).max(255).optional(),
  port: portSchema.optional(),
  database: z.string().min(1).max(255).optional(),
  user: z.string().min(1).max(255).optional(),
  /** Omit to leave the stored password unchanged. */
  password: z.string().optional(),
  readOnly: z.boolean().optional(),
  maxConnections: maxConnectionsSchema.optional(),
  statementTimeoutMs: statementTimeoutSchema.optional(),
  maxRows: maxRowsSchema.optional(),
});

export type UpdateDataSourceInput = z.infer<typeof updateDataSourceSchema>;

// ----- Query (dbQuery bridge / test) -----

export const dbQueryInputSchema = z.object({
  sql: z.string().min(1),
  params: z.array(z.unknown()).default([]),
});

export type DbQueryInput = z.infer<typeof dbQueryInputSchema>;

// ----- Params -----

export const dataSourceUuidParamSchema = z.object({
  id: z.string().uuid(),
});
