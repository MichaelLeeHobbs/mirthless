// ===========================================
// Channel Scripts Table Schema
// ===========================================

import { pgTable, uuid, varchar, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { channels } from './channels.js';

export const channelScripts = pgTable('channel_scripts', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  scriptType: varchar('script_type', { length: 30 }).notNull(),
  script: text('script').notNull().default(''),
}, (table) => [
  uniqueIndex('channel_scripts_channel_type').on(table.channelId, table.scriptType),
]);

export type ChannelScript = typeof channelScripts.$inferSelect;
export type NewChannelScript = typeof channelScripts.$inferInsert;
