// ===========================================
// Channel Filters and Filter Rules Table Schema
// ===========================================

import { pgTable, uuid, varchar, text, boolean, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { channels } from './channels.js';
import { channelConnectors } from './channel-connectors.js';

export const channelFilters = pgTable('channel_filters', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  connectorId: uuid('connector_id')
    .references(() => channelConnectors.id, { onDelete: 'cascade' }),
  // connectorId NULL = source filter, non-NULL = destination filter
});

export const filterRules = pgTable('filter_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  filterId: uuid('filter_id')
    .notNull()
    .references(() => channelFilters.id, { onDelete: 'cascade' }),
  sequenceNumber: integer('sequence_number').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  operator: varchar('operator', { length: 10 }).notNull().default('AND'),
  type: varchar('type', { length: 30 }).notNull(),
  name: varchar('name', { length: 255 }),
  script: text('script'),

  // Rule builder fields (null for JavaScript type)
  field: varchar('field', { length: 255 }),
  condition: varchar('condition', { length: 50 }),
  values: jsonb('values').$type<ReadonlyArray<string>>(),
}, (table) => [
  index('filter_rules_filter_seq').on(table.filterId, table.sequenceNumber),
]);

export type ChannelFilter = typeof channelFilters.$inferSelect;
export type NewChannelFilter = typeof channelFilters.$inferInsert;
export type FilterRule = typeof filterRules.$inferSelect;
export type NewFilterRule = typeof filterRules.$inferInsert;
