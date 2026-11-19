// See docs/design/11-datasources.md.

import { z } from 'zod/v4';

export const DB_DRIVER = {
  POSTGRES: 'postgres',
} as const;
export type DbDriver = (typeof DB_DRIVER)[keyof typeof DB_DRIVER];

const portSchema = z.number().int().min(1).max(65_535);
const maxConnectionsSchema = z.number().int().min(1).max(50);
const statementTimeoutSchema = z.number().int().min(100).max(600_000);
const maxRowsSchema = z.number().int().min(1).max(1_000_000);

export const createDataSourceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().default(''),
  driver: z.literal('postgres').default('postgres'),
  host: z.string().min(1).max(255),
  port: portSchema.default(5432),
  database: z.string().min(1).max(255),
  user: z.string().min(1).max(255),
  /** Stored encrypted at rest. */
  password: z.string(),
  /** Enforced by the database role and a read-only transaction. */
  readOnly: z.boolean().default(true),
  /** Connect with TLS and verify the server certificate. */
  tls: z.boolean().default(false),
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
  tls: z.boolean().optional(),
  maxConnections: maxConnectionsSchema.optional(),
  statementTimeoutMs: statementTimeoutSchema.optional(),
  maxRows: maxRowsSchema.optional(),
});

export type UpdateDataSourceInput = z.infer<typeof updateDataSourceSchema>;

export const dbQueryInputSchema = z.object({
  sql: z.string().min(1),
  params: z.array(z.unknown()).default([]),
});

export type DbQueryInput = z.infer<typeof dbQueryInputSchema>;

export const testDataSourceSchema = z.object({
  host: z.string().min(1).max(255),
  port: portSchema.default(5432),
  database: z.string().min(1).max(255),
  user: z.string().min(1).max(255),
  password: z.string(),
  tls: z.boolean().default(false),
});

export type TestDataSourceInput = z.infer<typeof testDataSourceSchema>;

export const dataSourceUuidParamSchema = z.object({
  id: z.string().uuid(),
});
