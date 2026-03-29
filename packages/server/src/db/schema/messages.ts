// ===========================================
// Messages Table Schema
// ===========================================

import { pgTable, uuid, varchar, timestamp, boolean, bigint, bigserial, primaryKey, index } from 'drizzle-orm/pg-core';

export const messages = pgTable('messages', {
  id: bigserial('id', { mode: 'number' }).notNull(),
  channelId: uuid('channel_id').notNull(),
  serverId: varchar('server_id', { length: 36 }),
  correlationId: uuid('correlation_id').notNull().defaultRandom(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processed: boolean('processed').notNull().default(false),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  originalMessageId: bigint('original_message_id', { mode: 'number' }),
  importId: bigint('import_id', { mode: 'number' }),
  importChannelId: uuid('import_channel_id'),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.id] }),
  index('messages_received_idx').on(table.channelId, table.receivedAt),
  index('messages_processed_idx').on(table.channelId, table.processed),
  index('messages_correlation_idx').on(table.correlationId),
]);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
