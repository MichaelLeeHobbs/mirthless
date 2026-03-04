// ===========================================
// Channels Table Schema
// ===========================================

import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').default(''),
  enabled: boolean('enabled').notNull().default(false),
  revision: integer('revision').notNull().default(1),

  // Data types
  inboundDataType: varchar('inbound_data_type', { length: 50 }).notNull(),
  outboundDataType: varchar('outbound_data_type', { length: 50 }).notNull(),

  // Deploy behavior
  initialState: varchar('initial_state', { length: 20 }).notNull().default('STOPPED'),

  // Message storage
  messageStorageMode: varchar('message_storage_mode', { length: 20 }).notNull().default('DEVELOPMENT'),
  encryptData: boolean('encrypt_data').notNull().default(false),
  removeContentOnCompletion: boolean('remove_content_on_completion').notNull().default(false),
  removeAttachmentsOnCompletion: boolean('remove_attachments_on_completion').notNull().default(false),

  // Pruning
  pruningEnabled: boolean('pruning_enabled').notNull().default(false),
  pruningMaxAgeDays: integer('pruning_max_age_days'),
  pruningArchiveEnabled: boolean('pruning_archive_enabled').notNull().default(false),

  // Script execution timeout (seconds)
  scriptTimeoutSeconds: integer('script_timeout_seconds').notNull().default(30),

  // Source connector (always exactly one — inline rather than separate join)
  sourceConnectorType: varchar('source_connector_type', { length: 50 }).notNull(),
  sourceConnectorProperties: jsonb('source_connector_properties').notNull().$type<Record<string, unknown>>(),

  // Response handling
  responseMode: varchar('response_mode', { length: 30 }).notNull().default('AUTO_AFTER_DESTINATIONS'),
  responseConnectorName: varchar('response_connector_name', { length: 255 }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  lastDeployedAt: timestamp('last_deployed_at', { withTimezone: true }),
});

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
