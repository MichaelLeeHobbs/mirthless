// ===========================================
// Channel Tags Table Schema
// ===========================================

import { pgTable, uuid, varchar, primaryKey } from 'drizzle-orm/pg-core';
import { channels } from './channels.js';

export const channelTags = pgTable('channel_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  color: varchar('color', { length: 7 }),
});

export const channelTagAssignments = pgTable('channel_tag_assignments', {
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id')
    .notNull()
    .references(() => channelTags.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.tagId] }),
]);

export type ChannelTag = typeof channelTags.$inferSelect;
export type NewChannelTag = typeof channelTags.$inferInsert;
export type ChannelTagAssignment = typeof channelTagAssignments.$inferSelect;
export type NewChannelTagAssignment = typeof channelTagAssignments.$inferInsert;
