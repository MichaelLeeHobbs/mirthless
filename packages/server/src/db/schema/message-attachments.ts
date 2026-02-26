// ===========================================
// Message Attachments Table Schema
// ===========================================
// Note: content uses text as a placeholder until bytea custom type is implemented.

import { pgTable, uuid, varchar, text, boolean, integer, bigint, primaryKey, index } from 'drizzle-orm/pg-core';

export const messageAttachments = pgTable('message_attachments', {
  id: varchar('id', { length: 255 }).notNull(),
  channelId: uuid('channel_id').notNull(),
  messageId: bigint('message_id', { mode: 'number' }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }),
  segmentId: integer('segment_id').notNull().default(0),
  attachmentSize: integer('attachment_size').notNull(),
  content: text('content').notNull(),
  isEncrypted: boolean('is_encrypted').notNull().default(false),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.id, table.segmentId] }),
  index('message_attachments_message_idx').on(table.channelId, table.messageId),
]);

export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type NewMessageAttachment = typeof messageAttachments.$inferInsert;
