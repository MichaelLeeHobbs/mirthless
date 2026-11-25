import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';

/**
 * About the messages stored while a save still gave a destination's number to another (#395): those
 * whose `numberKept` is false, and those up to `upTo`. One is for the destination with its number only
 * if it was prepared under the name in `names`.
 */
export interface OldNumbers {
  readonly names: Readonly<Record<string, string>>;
  /**
   * Takes the place of `names` when the saved channel is deployed, and `upTo` becomes the last message
   * then: it has other destinations under some numbers than the version deployed when this was written.
   */
  readonly namesOnceDeployed?: Readonly<Record<string, string>>;
  readonly upTo?: number;
}

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').default(''),
  enabled: boolean('enabled').notNull().default(false),
  revision: integer('revision').notNull().default(1),

  inboundDataType: varchar('inbound_data_type', { length: 50 }).notNull(),
  outboundDataType: varchar('outbound_data_type', { length: 50 }).notNull(),

  initialState: varchar('initial_state', { length: 20 }).notNull().default('STOPPED'),

  messageStorageMode: varchar('message_storage_mode', { length: 20 }).notNull().default('DEVELOPMENT'),
  encryptData: boolean('encrypt_data').notNull().default(false),
  removeContentOnCompletion: boolean('remove_content_on_completion').notNull().default(false),
  removeAttachmentsOnCompletion: boolean('remove_attachments_on_completion').notNull().default(false),

  pruningEnabled: boolean('pruning_enabled').notNull().default(false),
  pruningMaxAgeDays: integer('pruning_max_age_days'),
  pruningArchiveEnabled: boolean('pruning_archive_enabled').notNull().default(false),

  scriptTimeoutSeconds: integer('script_timeout_seconds').notNull().default(30),

  // Exactly one source connector, so it is inline rather than its own table.
  sourceConnectorType: varchar('source_connector_type', { length: 50 }).notNull(),
  sourceConnectorProperties: jsonb('source_connector_properties').notNull().$type<Record<string, unknown>>(),

  responseMode: varchar('response_mode', { length: 30 }).notNull().default('AUTO_AFTER_DESTINATIONS'),
  responseConnectorName: varchar('response_connector_name', { length: 255 }),

  /** The number the next destination gets. It only goes up, so no destination gets one that another had (#395). */
  nextMetaDataId: integer('next_meta_data_id').notNull().default(1),
  /** Null for a channel without such messages. */
  oldNumbers: jsonb('old_numbers').$type<OldNumbers>(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  lastDeployedAt: timestamp('last_deployed_at', { withTimezone: true }),
});

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
