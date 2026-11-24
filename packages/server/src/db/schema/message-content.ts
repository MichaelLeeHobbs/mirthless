import { pgTable, uuid, varchar, text, boolean, integer, bigint, primaryKey } from 'drizzle-orm/pg-core';

export const messageContent = pgTable('message_content', {
  channelId: uuid('channel_id').notNull(),
  messageId: bigint('message_id', { mode: 'number' }).notNull(),
  metaDataId: integer('meta_data_id').notNull(),
  /** CONTENT_TYPE in core-models. */
  contentType: integer('content_type').notNull(),
  content: text('content'),
  dataType: varchar('data_type', { length: 50 }),
  isEncrypted: boolean('is_encrypted').notNull().default(false),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.messageId, table.metaDataId, table.contentType] }),
]);

export type MessageContent = typeof messageContent.$inferSelect;
export type NewMessageContent = typeof messageContent.$inferInsert;
