// The protected audit record (#264, D-312). Insert-only. Migration 0017 makes it a table
// partitioned by month on occurred_at, with triggers that refuse UPDATE,
// DELETE and TRUNCATE; the server's role holds SELECT and INSERT only
// (db/runtime-role.ts). Drizzle sees an ordinary table: the partitions,
// triggers and owner functions live only in the migration.
//
// No foreign keys: a key to users would rewrite audit rows when a user is
// deleted, which the triggers refuse. user_id and channel_id keep the id the
// row was written with.

import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp, bigserial, jsonb, index, primaryKey } from 'drizzle-orm/pg-core';

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  action: varchar('action', { length: 100 }).notNull(),
  outcome: varchar('outcome', { length: 20 }).notNull(),
  userId: uuid('user_id'),
  channelId: uuid('channel_id'),
  ipAddress: varchar('ip_address', { length: 45 }),
  attributes: jsonb('attributes').$type<Record<string, unknown>>(),
}, (table) => [
  // A partitioned table's primary key must include the partition column.
  primaryKey({ columns: [table.id, table.occurredAt] }),
  index('audit_log_occurred_at_idx').on(table.occurredAt),
  index('audit_log_user_idx').on(table.userId, table.occurredAt),
  index('audit_log_channel_idx').on(table.channelId, table.occurredAt),
  index('audit_log_action_idx').on(table.action, table.occurredAt),
  // The grant rows the access replay reads (lib/grant-replay.ts GRANT_REPLAY_ACTIONS,
  // keep the two lists the same), so a lookup by date never walks the PHI-read rows.
  index('audit_log_grant_idx').on(table.occurredAt, table.id).where(sql`${table.action} IN ('GRANT_BASELINE', 'ASSIGNMENTS_CHANGED', 'CHANNEL_GROUPS_CHANGED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED', 'USER_ENABLED_CHANGED')`),
]);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
