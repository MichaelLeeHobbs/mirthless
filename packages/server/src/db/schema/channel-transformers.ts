// ===========================================
// Channel Transformers and Transformer Steps Table Schema
// ===========================================

import { pgTable, uuid, varchar, text, boolean, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { channels } from './channels.js';
import { channelConnectors } from './channel-connectors.js';

export const channelTransformers = pgTable('channel_transformers', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  connectorId: uuid('connector_id')
    .references(() => channelConnectors.id, { onDelete: 'cascade' }),
  // connectorId NULL = source transformer, non-NULL = destination transformer
  inboundDataType: varchar('inbound_data_type', { length: 50 }).notNull(),
  outboundDataType: varchar('outbound_data_type', { length: 50 }).notNull(),
  inboundProperties: jsonb('inbound_properties').notNull().$type<Record<string, unknown>>(),
  outboundProperties: jsonb('outbound_properties').notNull().$type<Record<string, unknown>>(),
  inboundTemplate: text('inbound_template'),
  outboundTemplate: text('outbound_template'),
});

export const transformerSteps = pgTable('transformer_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  transformerId: uuid('transformer_id')
    .notNull()
    .references(() => channelTransformers.id, { onDelete: 'cascade' }),
  sequenceNumber: integer('sequence_number').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  name: varchar('name', { length: 255 }),
  type: varchar('type', { length: 30 }).notNull(),
  script: text('script'),

  // Mapper fields (null for other types)
  sourceField: varchar('source_field', { length: 500 }),
  targetField: varchar('target_field', { length: 500 }),
  defaultValue: text('default_value'),
  mapping: varchar('mapping', { length: 30 }),
}, (table) => [
  index('transformer_steps_trans_seq').on(table.transformerId, table.sequenceNumber),
]);

export type ChannelTransformer = typeof channelTransformers.$inferSelect;
export type NewChannelTransformer = typeof channelTransformers.$inferInsert;
export type TransformerStep = typeof transformerSteps.$inferSelect;
export type NewTransformerStep = typeof transformerSteps.$inferInsert;
