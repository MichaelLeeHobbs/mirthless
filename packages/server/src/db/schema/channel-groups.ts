// ===========================================
// Channel Groups Table Schema
// ===========================================

import { pgTable, uuid, varchar, text, timestamp, integer, primaryKey } from 'drizzle-orm/pg-core';
import { channels } from './channels.js';

export const channelGroups = pgTable('channel_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description').default(''),
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const channelGroupMembers = pgTable('channel_group_members', {
  channelGroupId: uuid('channel_group_id')
    .notNull()
    .references(() => channelGroups.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.channelGroupId, table.channelId] }),
]);

export type ChannelGroup = typeof channelGroups.$inferSelect;
export type NewChannelGroup = typeof channelGroups.$inferInsert;
export type ChannelGroupMember = typeof channelGroupMembers.$inferSelect;
export type NewChannelGroupMember = typeof channelGroupMembers.$inferInsert;
