// ===========================================
// Message Content Table Schema
// ===========================================

import { pgTable, uuid, varchar, text, boolean, integer, bigint, primaryKey } from 'drizzle-orm/pg-core';

export const CONTENT_TYPE = {
  RAW: 1,
  PROCESSED: 2,
  TRANSFORMED: 3,
  ENCODED: 4,
  SENT: 5,
  RESPONSE: 6,
  RESPONSE_TRANSFORMED: 7,
  RESPONSE_SENT: 8,
  SOURCE_MAP: 9,
  CHANNEL_MAP: 10,
  ERROR: 11,
  RESPONSE_ERROR: 12,
  PROCESSING_ERROR: 13,
} as const;

export type ContentType = (typeof CONTENT_TYPE)[keyof typeof CONTENT_TYPE];

export const messageContent = pgTable('message_content', {
  channelId: uuid('channel_id').notNull(),
  messageId: bigint('message_id', { mode: 'number' }).notNull(),
  metaDataId: integer('meta_data_id').notNull(),
  contentType: integer('content_type').notNull(),
  content: text('content'),
  dataType: varchar('data_type', { length: 50 }),
  isEncrypted: boolean('is_encrypted').notNull().default(false),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.messageId, table.metaDataId, table.contentType] }),
]);

export type MessageContent = typeof messageContent.$inferSelect;
export type NewMessageContent = typeof messageContent.$inferInsert;
