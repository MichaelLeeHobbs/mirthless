// ===========================================
// Channel Metadata Columns Table Schema
// ===========================================

import { pgTable, uuid, varchar, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { channels } from './channels.js';

export const channelMetadataColumns = pgTable('channel_metadata_columns', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  dataType: varchar('data_type', { length: 20 }).notNull(),
  mappingExpression: text('mapping_expression'),
}, (table) => [
  uniqueIndex('channel_metadata_cols_channel_name').on(table.channelId, table.name),
]);

export type ChannelMetadataColumn = typeof channelMetadataColumns.$inferSelect;
export type NewChannelMetadataColumn = typeof channelMetadataColumns.$inferInsert;
