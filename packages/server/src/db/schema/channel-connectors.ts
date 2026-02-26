// ===========================================
// Channel Connectors Table Schema (Destinations)
// ===========================================

import { pgTable, uuid, varchar, timestamp, boolean, integer, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { channels } from './channels.js';

export const channelConnectors = pgTable('channel_connectors', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  metaDataId: integer('meta_data_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  connectorType: varchar('connector_type', { length: 50 }).notNull(),
  properties: jsonb('properties').notNull().$type<Record<string, unknown>>(),

  // Queue settings
  queueMode: varchar('queue_mode', { length: 20 }).notNull().default('NEVER'),
  retryCount: integer('retry_count').notNull().default(0),
  retryIntervalMs: integer('retry_interval_ms').notNull().default(10_000),
  rotateQueue: boolean('rotate_queue').notNull().default(false),
  queueThreadCount: integer('queue_thread_count').notNull().default(1),

  // Destination chain
  chainId: integer('chain_id').notNull().default(0),
  orderInChain: integer('order_in_chain').notNull().default(0),
  waitForPrevious: boolean('wait_for_previous').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('channel_connectors_channel_meta').on(table.channelId, table.metaDataId),
]);

export type ChannelConnector = typeof channelConnectors.$inferSelect;
export type NewChannelConnector = typeof channelConnectors.$inferInsert;
