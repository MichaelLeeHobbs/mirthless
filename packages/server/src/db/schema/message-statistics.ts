// ===========================================
// Message Statistics Table Schema
// ===========================================

import { pgTable, uuid, varchar, integer, bigint, primaryKey } from 'drizzle-orm/pg-core';

export const messageStatistics = pgTable('message_statistics', {
  channelId: uuid('channel_id').notNull(),
  metaDataId: integer('meta_data_id'),
  serverId: varchar('server_id', { length: 36 }).notNull(),
  received: bigint('received', { mode: 'number' }).notNull().default(0),
  filtered: bigint('filtered', { mode: 'number' }).notNull().default(0),
  sent: bigint('sent', { mode: 'number' }).notNull().default(0),
  errored: bigint('errored', { mode: 'number' }).notNull().default(0),
  receivedLifetime: bigint('received_lifetime', { mode: 'number' }).notNull().default(0),
  filteredLifetime: bigint('filtered_lifetime', { mode: 'number' }).notNull().default(0),
  sentLifetime: bigint('sent_lifetime', { mode: 'number' }).notNull().default(0),
  erroredLifetime: bigint('errored_lifetime', { mode: 'number' }).notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.metaDataId, table.serverId] }),
]);

export type MessageStatistic = typeof messageStatistics.$inferSelect;
export type NewMessageStatistic = typeof messageStatistics.$inferInsert;
