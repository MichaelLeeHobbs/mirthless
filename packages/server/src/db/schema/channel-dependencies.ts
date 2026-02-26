// ===========================================
// Channel Dependencies Table Schema
// ===========================================

import { pgTable, uuid, primaryKey } from 'drizzle-orm/pg-core';
import { channels } from './channels.js';

export const channelDependencies = pgTable('channel_dependencies', {
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  dependsOnChannelId: uuid('depends_on_channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.dependsOnChannelId] }),
]);

export type ChannelDependency = typeof channelDependencies.$inferSelect;
export type NewChannelDependency = typeof channelDependencies.$inferInsert;
