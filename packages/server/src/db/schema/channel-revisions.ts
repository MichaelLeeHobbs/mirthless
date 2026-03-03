// ===========================================
// Channel Revisions Table Schema
// ===========================================

import { pgTable, uuid, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';

export const channelRevisions = pgTable('channel_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull(),
  revision: integer('revision').notNull(),
  userId: uuid('user_id'),
  snapshot: jsonb('snapshot').notNull().$type<Record<string, unknown>>(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ChannelRevision = typeof channelRevisions.$inferSelect;
export type NewChannelRevision = typeof channelRevisions.$inferInsert;
