// ===========================================
// Data Sources Table Schema
// ===========================================
// Admin-managed database connection profiles that channel scripts query via
// dbQuery(dataSourceName, sql, params). The password is stored encrypted at rest
// (content-crypto envelope). See docs/design/11-datasources.md.

import { pgTable, uuid, varchar, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

export const dataSources = pgTable('data_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description').notNull().default(''),
  driver: varchar('driver', { length: 32 }).notNull().default('postgres'),
  host: varchar('host', { length: 255 }).notNull(),
  port: integer('port').notNull().default(5432),
  database: varchar('database', { length: 255 }).notNull(),
  dbUser: varchar('db_user', { length: 255 }).notNull(),
  /** content-crypto envelope; never returned by the API. */
  passwordEncrypted: text('password_encrypted').notNull(),
  readOnly: boolean('read_only').notNull().default(true),
  maxConnections: integer('max_connections').notNull().default(5),
  statementTimeoutMs: integer('statement_timeout_ms').notNull().default(30_000),
  maxRows: integer('max_rows').notNull().default(10_000),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type DataSource = typeof dataSources.$inferSelect;
export type NewDataSource = typeof dataSources.$inferInsert;
