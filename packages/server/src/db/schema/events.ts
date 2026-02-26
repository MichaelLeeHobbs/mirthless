// ===========================================
// Events Table Schema
// ===========================================
// Audit log for HIPAA compliance and operational auditing.

import { pgTable, uuid, varchar, text, timestamp, bigserial, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const events = pgTable('events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  level: varchar('level', { length: 20 }).notNull(),
  name: text('name').notNull(),
  outcome: varchar('outcome', { length: 20 }).notNull(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  ipAddress: varchar('ip_address', { length: 45 }),
  channelId: uuid('channel_id'),
  serverId: varchar('server_id', { length: 36 }),
  attributes: jsonb('attributes').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('events_created_at_idx').on(table.createdAt),
  index('events_level_idx').on(table.level),
  index('events_channel_id_idx').on(table.channelId),
]);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
