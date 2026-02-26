// ===========================================
// Message Custom Metadata Table Schema
// ===========================================

import { pgTable, uuid, integer, bigint, jsonb, primaryKey, index } from 'drizzle-orm/pg-core';

export const messageCustomMetadata = pgTable('message_custom_metadata', {
  channelId: uuid('channel_id').notNull(),
  messageId: bigint('message_id', { mode: 'number' }).notNull(),
  metaDataId: integer('meta_data_id').notNull(),
  metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>(),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.messageId, table.metaDataId] }),
  index('message_custom_metadata_gin').using('gin', table.metadata),
]);

export type MessageCustomMetadata = typeof messageCustomMetadata.$inferSelect;
export type NewMessageCustomMetadata = typeof messageCustomMetadata.$inferInsert;
