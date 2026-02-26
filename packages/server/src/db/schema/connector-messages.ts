// ===========================================
// Connector Messages Table Schema
// ===========================================

import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp, integer, bigint, primaryKey, index } from 'drizzle-orm/pg-core';

export const MESSAGE_STATUS = {
  RECEIVED: 'RECEIVED',
  FILTERED: 'FILTERED',
  TRANSFORMED: 'TRANSFORMED',
  SENT: 'SENT',
  QUEUED: 'QUEUED',
  ERROR: 'ERROR',
  PENDING: 'PENDING',
} as const;

export type MessageStatus = (typeof MESSAGE_STATUS)[keyof typeof MESSAGE_STATUS];

export const connectorMessages = pgTable('connector_messages', {
  channelId: uuid('channel_id').notNull(),
  messageId: bigint('message_id', { mode: 'number' }).notNull(),
  metaDataId: integer('meta_data_id').notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  connectorName: varchar('connector_name', { length: 255 }),
  sendAttempts: integer('send_attempts').notNull().default(0),
  sendDate: timestamp('send_date', { withTimezone: true }),
  responseDate: timestamp('response_date', { withTimezone: true }),
  errorCode: integer('error_code').notNull().default(0),
  chainId: integer('chain_id').notNull().default(0),
  orderId: integer('order_id').notNull().default(0),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.messageId, table.metaDataId] }),
  index('connector_messages_status_idx').on(table.channelId, table.metaDataId, table.status),
  index('connector_messages_queued_idx')
    .on(table.channelId, table.metaDataId, table.status)
    .where(sql`status = 'QUEUED'`),
]);

export type ConnectorMessage = typeof connectorMessages.$inferSelect;
export type NewConnectorMessage = typeof connectorMessages.$inferInsert;
