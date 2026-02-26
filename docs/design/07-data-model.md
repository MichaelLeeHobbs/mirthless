# 07 — Data Model Design

> PostgreSQL schema, Drizzle ORM, message storage, and migration strategy.

## What Connect Does

Connect stores almost everything as **XML blobs** in a minimal relational schema:
- `CHANNEL` table has a `CHANNEL TEXT` column containing the entire channel config as XML
- `ALERT`, `CODE_TEMPLATE`, `CODE_TEMPLATE_LIBRARY`, `CHANNEL_GROUP` — same pattern: XML TEXT
- Message tables are **created dynamically per channel** (`D_M{id}`, `D_MM{id}`, `D_MC{id}`, etc.)
- Configuration is a key-value `CONFIGURATION` table

### Problems with Connect's Approach

1. **XML blobs** — Can't query individual fields. No referential integrity. No partial updates.
2. **Dynamic table creation** — Creates 6+ tables per deployed channel. 200 channels = 1,200+ tables. Hard to maintain, migrate, and monitor.
3. **No foreign keys** — Between configuration tables (channels, alerts, code templates)
4. **Single-char status codes** — `R`, `S`, `P`, `F` instead of readable values
5. **No created_at/updated_at** — On configuration tables
6. **No soft deletes** — Configuration is hard-deleted

## Our Approach

1. **Normalized tables** — Channel config is stored in proper relational tables, not XML blobs
2. **Single message table** — All channel messages in one table, partitioned by `channel_id` (Postgres range/list partitioning)
3. **Drizzle ORM** — Type-safe schema, migrations, and queries
4. **Branded IDs everywhere** — `ChannelId`, `UserId`, `MessageId` as branded strings
5. **Audit columns** — `created_at`, `updated_at` on all tables
6. **Soft deletes** — `deleted_at` on configuration entities

---

## Schema Overview

```
┌────────────────────────────────────────────────────────────────┐
│ Configuration Tables (normalized)                              │
│                                                                │
│  channels ──┬── channel_connectors ── connector_properties     │
│             ├── channel_filters ── filter_rules                │
│             ├── channel_transformers ── transformer_steps       │
│             ├── channel_scripts                                │
│             ├── channel_metadata_columns                       │
│             └── channel_dependencies                           │
│                                                                │
│  channel_groups ── channel_group_members                       │
│  channel_tags ── channel_tag_assignments                       │
│                                                                │
│  code_template_libraries ── code_templates                     │
│  alerts ── alert_channels ── alert_actions                     │
│  users ── user_roles ── user_preferences ── sessions           │
│  global_scripts, configuration                                 │
├────────────────────────────────────────────────────────────────┤
│ Message Tables (partitioned)                                   │
│                                                                │
│  messages ── connector_messages ── message_content              │
│                                   message_custom_metadata      │
│                                   message_attachments          │
│  message_statistics                                            │
├────────────────────────────────────────────────────────────────┤
│ System Tables                                                  │
│                                                                │
│  events (audit log)                                            │
│  schema_info (migration tracking — handled by drizzle-kit)     │
└────────────────────────────────────────────────────────────────┘
```

---

## Configuration Tables

### channels

The core table. One row per channel.

```typescript
export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),        // ChannelId
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').default(''),
  enabled: boolean('enabled').notNull().default(false),
  revision: integer('revision').notNull().default(1),

  // Data types
  inboundDataType: varchar('inbound_data_type', { length: 50 }).notNull(), // 'HL7V2' | 'XML' | 'JSON' | ...
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

  // Source connector (always exactly one — inline rather than separate join)
  sourceConnectorType: varchar('source_connector_type', { length: 50 }).notNull(),
  sourceConnectorProperties: jsonb('source_connector_properties').notNull().$type<Record<string, unknown>>(),

  // Response handling
  responseMode: varchar('response_mode', { length: 30 }).notNull().default('AUTO_AFTER_DESTINATIONS'),
  responseConnectorName: varchar('response_connector_name', { length: 255 }), // For DESTINATION mode

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  lastDeployedAt: timestamp('last_deployed_at', { withTimezone: true }),
});
```

### channel_connectors (destinations)

```typescript
export const channelConnectors = pgTable('channel_connectors', {
  id: uuid('id').primaryKey().defaultRandom(),        // ConnectorId
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  metaDataId: integer('meta_data_id').notNull(),      // 1-based index (0 = source)
  name: varchar('name', { length: 255 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  connectorType: varchar('connector_type', { length: 50 }).notNull(),
  properties: jsonb('properties').notNull().$type<Record<string, unknown>>(),

  // Queue settings
  queueMode: varchar('queue_mode', { length: 20 }).notNull().default('NEVER'), // 'NEVER' | 'ON_FAILURE' | 'ALWAYS'
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
```

### channel_filters and filter_rules

```typescript
export const channelFilters = pgTable('channel_filters', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  connectorId: uuid('connector_id').references(() => channelConnectors.id, { onDelete: 'cascade' }),
  // connectorId NULL = source filter, non-NULL = destination filter
});

export const filterRules = pgTable('filter_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  filterId: uuid('filter_id').notNull().references(() => channelFilters.id, { onDelete: 'cascade' }),
  sequenceNumber: integer('sequence_number').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  operator: varchar('operator', { length: 10 }).notNull().default('AND'), // 'AND' | 'OR'
  type: varchar('type', { length: 30 }).notNull(), // 'JAVASCRIPT' | 'RULE_BUILDER' | 'EXTERNAL_SCRIPT'
  name: varchar('name', { length: 255 }),
  script: text('script'),

  // Rule builder fields (null for JavaScript type)
  field: varchar('field', { length: 255 }),
  condition: varchar('condition', { length: 50 }),  // 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | ...
  values: jsonb('values').$type<ReadonlyArray<string>>(),
}, (table) => [
  index('filter_rules_filter_seq').on(table.filterId, table.sequenceNumber),
]);
```

### channel_transformers and transformer_steps

```typescript
export const channelTransformers = pgTable('channel_transformers', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  connectorId: uuid('connector_id').references(() => channelConnectors.id, { onDelete: 'cascade' }),
  // connectorId NULL = source transformer, non-NULL = destination transformer
  inboundDataType: varchar('inbound_data_type', { length: 50 }).notNull(),
  outboundDataType: varchar('outbound_data_type', { length: 50 }).notNull(),
  inboundProperties: jsonb('inbound_properties').notNull().$type<Record<string, unknown>>(), // DataTypeProperties (Zod-validated)
  outboundProperties: jsonb('outbound_properties').notNull().$type<Record<string, unknown>>(), // DataTypeProperties (Zod-validated)
  inboundTemplate: text('inbound_template'),
  outboundTemplate: text('outbound_template'),
});

export const transformerSteps = pgTable('transformer_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  transformerId: uuid('transformer_id').notNull().references(() => channelTransformers.id, { onDelete: 'cascade' }),
  sequenceNumber: integer('sequence_number').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  name: varchar('name', { length: 255 }),
  type: varchar('type', { length: 30 }).notNull(), // 'JAVASCRIPT' | 'MAPPER' | 'MESSAGE_BUILDER' | 'XSLT'
  script: text('script'),

  // Mapper fields (null for other types)
  sourceField: varchar('source_field', { length: 500 }),
  targetField: varchar('target_field', { length: 500 }),
  defaultValue: text('default_value'),
  mapping: varchar('mapping', { length: 30 }),  // 'COPY' | 'JAVASCRIPT' | 'GLOBAL_MAP' | ...
}, (table) => [
  index('transformer_steps_trans_seq').on(table.transformerId, table.sequenceNumber),
]);
```

### channel_scripts

```typescript
export const channelScripts = pgTable('channel_scripts', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  scriptType: varchar('script_type', { length: 30 }).notNull(), // 'PREPROCESSOR' | 'POSTPROCESSOR' | 'DEPLOY' | 'UNDEPLOY' | 'ATTACHMENT'
  script: text('script').notNull().default(''),
}, (table) => [
  uniqueIndex('channel_scripts_channel_type').on(table.channelId, table.scriptType),
]);
```

### channel_metadata_columns

Custom metadata columns that users define for search and filtering.

```typescript
export const channelMetadataColumns = pgTable('channel_metadata_columns', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  dataType: varchar('data_type', { length: 20 }).notNull(), // 'STRING' | 'NUMBER' | 'BOOLEAN' | 'TIMESTAMP'
  mappingExpression: text('mapping_expression'),
}, (table) => [
  uniqueIndex('channel_metadata_cols_channel_name').on(table.channelId, table.name),
]);
```

### channel_dependencies

```typescript
export const channelDependencies = pgTable('channel_dependencies', {
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  dependsOnChannelId: uuid('depends_on_channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.dependsOnChannelId] }),
]);
```

### channel_groups and channel_tags

```typescript
export const channelGroups = pgTable('channel_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description').default(''),
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const channelGroupMembers = pgTable('channel_group_members', {
  channelGroupId: uuid('channel_group_id').notNull().references(() => channelGroups.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.channelGroupId, table.channelId] }),
]);

export const channelTags = pgTable('channel_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  color: varchar('color', { length: 7 }), // Hex color (#FF0000)
});

export const channelTagAssignments = pgTable('channel_tag_assignments', {
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => channelTags.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.tagId] }),
]);
```

---

## Code Templates

```typescript
export const codeTemplateLibraries = pgTable('code_template_libraries', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description').default(''),
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const codeTemplates = pgTable('code_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  libraryId: uuid('library_id').notNull().references(() => codeTemplateLibraries.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').default(''),
  type: varchar('type', { length: 20 }).notNull(), // 'FUNCTION' | 'CODE_BLOCK'
  code: text('code').notNull().default(''),
  contexts: jsonb('contexts').notNull().$type<ReadonlyArray<string>>(), // Array of CodeTemplateContext values
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

---

## Alerts

```typescript
export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description').default(''),
  enabled: boolean('enabled').notNull().default(true),
  triggerType: varchar('trigger_type', { length: 30 }).notNull(), // 'ERROR' | 'CUSTOM'
  triggerScript: text('trigger_script'), // Custom JavaScript condition
  subjectTemplate: text('subject_template'),
  bodyTemplate: text('body_template'),
  reAlertIntervalMs: integer('re_alert_interval_ms'),
  maxAlerts: integer('max_alerts'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const alertChannels = pgTable('alert_channels', {
  alertId: uuid('alert_id').notNull().references(() => alerts.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.alertId, table.channelId] }),
]);

export const alertActions = pgTable('alert_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  alertId: uuid('alert_id').notNull().references(() => alerts.id, { onDelete: 'cascade' }),
  actionType: varchar('action_type', { length: 30 }).notNull(), // 'EMAIL' | 'WEBHOOK' | ...
  recipients: jsonb('recipients').notNull().$type<ReadonlyArray<string>>(),
  properties: jsonb('properties').$type<Record<string, unknown>>(),
});
```

---

## Users and Auth

```typescript
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),          // UserId
  username: varchar('username', { length: 100 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  description: text('description'),
  role: varchar('role', { length: 50 }).notNull().default('viewer'), // 'admin' | 'deployer' | 'developer' | 'viewer'
  enabled: boolean('enabled').notNull().default(true),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  mfaSecret: varchar('mfa_secret', { length: 255 }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userPermissions = pgTable('user_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  resource: varchar('resource', { length: 50 }).notNull(),
  action: varchar('action', { length: 20 }).notNull(),
  scope: jsonb('scope').notNull().$type<'all' | ReadonlyArray<string>>(), // 'all' or array of ChannelIds
}, (table) => [
  index('user_permissions_user').on(table.userId),
]);

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 255 }).notNull(),
  value: text('value'),
}, (table) => [
  primaryKey({ columns: [table.userId, table.key] }),
]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenHash: varchar('refresh_token_hash', { length: 255 }).notNull(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('sessions_user').on(table.userId),
  index('sessions_expires').on(table.expiresAt),
]);
```

---

## Message Tables

### Design Decision: Partitioned Tables

Connect creates 6 tables per channel. With 200 channels, that's 1,200 tables. Instead, we use a **single set of message tables partitioned by channel_id**:

- Postgres list partitioning on `channel_id`
- Partitions created/dropped when channels are created/deleted
- Same query performance as per-channel tables (Postgres prunes partitions)
- Simpler to manage, migrate, and monitor

### messages

```typescript
export const messages = pgTable('messages', {
  id: bigserial('id', { mode: 'bigint' }).notNull(),
  channelId: uuid('channel_id').notNull(),
  serverId: varchar('server_id', { length: 36 }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processed: boolean('processed').notNull().default(false),
  originalMessageId: bigint('original_message_id', { mode: 'bigint' }),
  importId: bigint('import_id', { mode: 'bigint' }),
  importChannelId: uuid('import_channel_id'),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.id] }),
  index('messages_received').on(table.channelId, table.receivedAt),
  index('messages_processed').on(table.channelId, table.processed),
]);
// PARTITION BY LIST (channel_id)
```

### connector_messages

```typescript
export const MESSAGE_STATUS = {
  RECEIVED: 'RECEIVED',
  FILTERED: 'FILTERED',
  TRANSFORMED: 'TRANSFORMED',
  SENT: 'SENT',
  QUEUED: 'QUEUED',
  ERROR: 'ERROR',
  PENDING: 'PENDING',
} as const;

export const connectorMessages = pgTable('connector_messages', {
  channelId: uuid('channel_id').notNull(),
  messageId: bigint('message_id', { mode: 'bigint' }).notNull(),
  metaDataId: integer('meta_data_id').notNull(), // 0 = source, 1+ = destinations
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
  index('connector_messages_status').on(table.channelId, table.metaDataId, table.status),
  index('connector_messages_queued').on(table.channelId, table.metaDataId, table.status)
    .where(sql`status = 'QUEUED'`), // Partial index for queue consumer
]);
// PARTITION BY LIST (channel_id)
```

### message_content

```typescript
export const CONTENT_TYPE = {
  RAW: 1,
  PROCESSED: 2,
  TRANSFORMED: 3,
  ENCODED: 4,
  SENT: 5,
  RESPONSE: 6,
  RESPONSE_TRANSFORMED: 7,
  RESPONSE_SENT: 8,
  SOURCE_MAP: 9,
  CHANNEL_MAP: 10,
  ERROR: 11,
  RESPONSE_ERROR: 12,
  PROCESSING_ERROR: 13,
} as const;

export const messageContent = pgTable('message_content', {
  channelId: uuid('channel_id').notNull(),
  messageId: bigint('message_id', { mode: 'bigint' }).notNull(),
  metaDataId: integer('meta_data_id').notNull(),
  contentType: integer('content_type').notNull(),
  content: text('content'),
  dataType: varchar('data_type', { length: 50 }),
  isEncrypted: boolean('is_encrypted').notNull().default(false),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.messageId, table.metaDataId, table.contentType] }),
]);
// PARTITION BY LIST (channel_id)
```

### message_custom_metadata

Custom metadata values extracted by user-defined mapping expressions.

```typescript
export const messageCustomMetadata = pgTable('message_custom_metadata', {
  channelId: uuid('channel_id').notNull(),
  messageId: bigint('message_id', { mode: 'bigint' }).notNull(),
  metaDataId: integer('meta_data_id').notNull(),
  // Custom columns stored as JSONB for flexibility
  // (Connect uses ALTER TABLE to add columns dynamically — we avoid that)
  metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>(),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.messageId, table.metaDataId] }),
  // GIN index on JSONB for searching custom metadata values
  index('message_custom_metadata_gin').using('gin', table.metadata),
]);
// PARTITION BY LIST (channel_id)
```

### message_attachments

```typescript
export const messageAttachments = pgTable('message_attachments', {
  id: varchar('id', { length: 255 }).notNull(),
  channelId: uuid('channel_id').notNull(),
  messageId: bigint('message_id', { mode: 'bigint' }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }),
  segmentId: integer('segment_id').notNull().default(0),
  attachmentSize: integer('attachment_size').notNull(),
  content: customType<Buffer>('bytea').notNull(), // Binary data
  isEncrypted: boolean('is_encrypted').notNull().default(false),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.id, table.segmentId] }),
  index('message_attachments_message').on(table.channelId, table.messageId),
]);
// PARTITION BY LIST (channel_id)
```

### message_statistics

```typescript
export const messageStatistics = pgTable('message_statistics', {
  channelId: uuid('channel_id').notNull(),
  metaDataId: integer('meta_data_id'), // NULL = channel total, integer = connector
  serverId: varchar('server_id', { length: 36 }).notNull(),
  received: bigint('received', { mode: 'bigint' }).notNull().default(0n),
  filtered: bigint('filtered', { mode: 'bigint' }).notNull().default(0n),
  sent: bigint('sent', { mode: 'bigint' }).notNull().default(0n),
  errored: bigint('errored', { mode: 'bigint' }).notNull().default(0n),
  receivedLifetime: bigint('received_lifetime', { mode: 'bigint' }).notNull().default(0n),
  filteredLifetime: bigint('filtered_lifetime', { mode: 'bigint' }).notNull().default(0n),
  sentLifetime: bigint('sent_lifetime', { mode: 'bigint' }).notNull().default(0n),
  erroredLifetime: bigint('errored_lifetime', { mode: 'bigint' }).notNull().default(0n),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.metaDataId, table.serverId] }),
]);
```

---

## System Tables

### global_scripts

```typescript
export const globalScripts = pgTable('global_scripts', {
  scriptType: varchar('script_type', { length: 30 }).primaryKey(), // 'DEPLOY' | 'UNDEPLOY' | 'PREPROCESSOR' | 'POSTPROCESSOR'
  script: text('script').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### configuration

Key-value settings (for simple server config).

```typescript
export const configuration = pgTable('configuration', {
  category: varchar('category', { length: 100 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  value: text('value'),
}, (table) => [
  primaryKey({ columns: [table.category, table.name] }),
]);
```

### global_map_entries

Persistent key-value store accessible from all channels via `globalMap`.

```typescript
export const globalMapEntries = pgTable('global_map_entries', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: text('value'), // JSON-serialized
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### resources

Uploaded files available to channels (certs, XSLTs, lookup tables, CSV files, etc.).

```typescript
export const resources = pgTable('resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description').default(''),
  mimeType: varchar('mime_type', { length: 100 }),
  content: customType<Buffer>('bytea').notNull(), // Binary file content
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### events

Audit log. Every significant operation creates an event for HIPAA compliance and operational auditing.

**Event taxonomy — operations that create events:**

| Event Name | Level | Trigger |
|---|---|---|
| `SERVER_STARTUP` | INFO | Server starts |
| `SERVER_SHUTDOWN` | INFO | Server stops |
| `USER_LOGIN` | INFO | Successful login |
| `USER_LOGIN_FAILED` | WARN | Failed login attempt |
| `USER_LOGOUT` | INFO | User logs out |
| `USER_CREATED` | INFO | New user account |
| `USER_UPDATED` | INFO | User profile/role change |
| `USER_DELETED` | INFO | User removed |
| `CHANNEL_DEPLOYED` | INFO | Channel deployed |
| `CHANNEL_UNDEPLOYED` | INFO | Channel undeployed |
| `CHANNEL_STARTED` | INFO | Channel started |
| `CHANNEL_STOPPED` | INFO | Channel stopped |
| `CHANNEL_PAUSED` | INFO | Channel paused |
| `CHANNEL_CREATED` | INFO | New channel |
| `CHANNEL_UPDATED` | INFO | Channel configuration changed |
| `CHANNEL_DELETED` | INFO | Channel removed |
| `CHANNEL_EXPORTED` | INFO | Channel exported as JSON |
| `CHANNEL_IMPORTED` | INFO | Channel imported from JSON |
| `CODE_TEMPLATE_UPDATED` | INFO | Code template created/updated/deleted |
| `ALERT_UPDATED` | INFO | Alert created/updated/deleted |
| `SETTINGS_CHANGED` | INFO | Server settings modified |
| `GLOBAL_SCRIPT_UPDATED` | INFO | Global script modified |
| `MESSAGE_VIEWED` | INFO | PHI access — message content viewed (HIPAA audit) |
| `MESSAGE_REPROCESSED` | INFO | Message reprocessed |
| `MESSAGE_DELETED` | INFO | Message(s) deleted |
| `MESSAGES_PRUNED` | INFO | Data pruner removed messages |
| `BACKUP_CREATED` | INFO | Server backup exported |
| `BACKUP_RESTORED` | WARN | Server backup imported |
| `EXTENSION_ENABLED` | INFO | Plugin enabled |
| `EXTENSION_DISABLED` | INFO | Plugin disabled |
| `RESOURCE_UPLOADED` | INFO | Resource file uploaded |
| `RESOURCE_DELETED` | INFO | Resource file removed |

Each event stores the acting user, their IP address, affected channel (if applicable), and event-specific attributes as JSONB.

```typescript
export const events = pgTable('events', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  level: varchar('level', { length: 20 }).notNull(), // 'INFO' | 'WARN' | 'ERROR'
  name: text('name').notNull(),
  outcome: varchar('outcome', { length: 20 }).notNull(), // 'SUCCESS' | 'FAILURE'
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  ipAddress: varchar('ip_address', { length: 45 }),
  channelId: uuid('channel_id'),
  serverId: varchar('server_id', { length: 36 }),
  attributes: jsonb('attributes').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('events_created').on(table.createdAt),
  index('events_level').on(table.level),
  index('events_channel').on(table.channelId),
]);
```

---

## Partitioning Strategy

### Why Partition

Message tables grow fast in production. A busy HL7 interface can process 100K+ messages/day per channel. Without partitioning:
- Index scans slow down as table grows
- Vacuuming and maintenance become expensive
- Pruning old data requires DELETE (slow) instead of DROP PARTITION (instant)

### Implementation

```sql
-- Create partitioned table
CREATE TABLE messages (
  id BIGINT NOT NULL,
  channel_id UUID NOT NULL,
  ...
) PARTITION BY LIST (channel_id);

-- When a channel is created, create its partition
CREATE TABLE messages_p_{channel_id} PARTITION OF messages
  FOR VALUES IN ('{channel_id}');

-- When a channel is deleted, drop its partition (instant pruning)
DROP TABLE messages_p_{channel_id};
```

This is managed by the `ChannelService` — when a channel is created or deleted, the corresponding partition DDL is executed.

### Channel Pruning

Instead of expensive `DELETE` operations:

```typescript
class PruningService {
  async pruneChannel(channelId: ChannelId, maxAgeDays: number): Promise<Result<number>> {
    // Option 1: For time-based pruning within a partition, use DELETE with a partial index
    const result = await this.db.execute(sql`
      DELETE FROM messages
      WHERE channel_id = ${channelId}
        AND received_at < NOW() - INTERVAL '${maxAgeDays} days'
    `);
    return { ok: true, value: result.rowCount };
  }

  async deleteChannelData(channelId: ChannelId): Promise<Result<void>> {
    // Drop the partition entirely — instant regardless of row count
    await this.db.execute(sql`DROP TABLE IF EXISTS messages_p_${sql.raw(channelId.replace(/-/g, '_'))}`);
    // Same for connector_messages, message_content, etc.
    return { ok: true, value: undefined };
  }
}
```

---

## Queue Query Pattern

The `SKIP LOCKED` pattern for destination queue consumers:

```sql
-- Dequeue: atomic claim of queued messages
BEGIN;
  SELECT * FROM connector_messages
  WHERE channel_id = $1
    AND meta_data_id = $2
    AND status = 'QUEUED'
  ORDER BY message_id
  LIMIT $3
  FOR UPDATE SKIP LOCKED;

  -- Process message...

  UPDATE connector_messages
  SET status = 'SENT', send_date = NOW(), send_attempts = send_attempts + 1
  WHERE channel_id = $1 AND message_id = $4 AND meta_data_id = $2;
COMMIT;
```

The partial index on `status = 'QUEUED'` keeps this fast even as the table grows.

---

## Migration Strategy

### Drizzle Migrations

```bash
# Generate migration from schema changes
pnpm drizzle-kit generate

# Apply migrations
pnpm drizzle-kit migrate

# Push (dev only — sync schema without migration files)
pnpm drizzle-kit push
```

Migrations are stored in `drizzle/migrations/` and run at server startup.

### Schema Version

Drizzle tracks migrations via its own `__drizzle_migrations` table. No custom `schema_info` table needed.

---

## Key Differences from Connect

| Aspect | Connect | Mirthless |
|---|---|---|
| Config storage | XML blobs in TEXT columns | Normalized relational tables |
| Message tables | Dynamic per-channel (6 tables each) | Partitioned single table set |
| Message status | Single char (`R`, `S`, `P`, `F`) | Readable strings (`RECEIVED`, `SENT`, etc.) |
| Custom metadata | `ALTER TABLE` to add columns | JSONB with GIN index |
| IDs | Mixed (UUID for channels, int for users, sequence for messages) | UUID for config, bigint for messages |
| Queuing | In-memory LinkedHashMap + JDBC | Postgres `SKIP LOCKED` |
| Schema changes | Hand-written SQL deltas per DB vendor | Drizzle ORM migrations (Postgres only) |
| Audit columns | None on config tables | `created_at`, `updated_at` everywhere |
| Soft deletes | Hard delete only | `deleted_at` on config entities |
| Password storage | Custom Digester | bcrypt (12 rounds) |
| Foreign keys | None between config tables | Full referential integrity with CASCADE |

---

## Resolved Decisions

1. **JSONB + Zod for connector properties** — Connector properties stored as JSONB. Each connector type exports its own Zod schema for validation at the application boundary (on save, on deploy). No database-level constraints on individual properties — Zod handles it. This avoids a polymorphic table explosion and means adding/modifying connector properties requires no database migrations. See `01-core-models.md` Resolved Decision #1.

2. **Partition management: raw SQL via `PartitionManager` service** — No partition management library needed. `pg_partman` is designed for time-based partitioning, not list partitioning by UUID. Raw SQL is 3-4 statements per table set. The `ChannelService` calls a `PartitionManager` service class that executes `CREATE TABLE ... PARTITION OF` on channel create and `DROP TABLE` on channel delete via `db.execute(sql`...`)`. Drizzle schema defines tables normally; partition DDL is in custom migrations for the initial `PARTITION BY LIST` declaration.

3. **Custom metadata: JSONB + expression indexes with user opt-in** — JSONB with GIN index for existence/equality queries. When a user defines a custom metadata column, an expression index is optionally created (user chooses whether to index each column). Example: `CREATE INDEX ON message_custom_metadata ((metadata->>'mrn')) WHERE channel_id = '{id}'`. For numeric range queries: `(((metadata->>'priority')::numeric))`. This gives indexed-column performance without ALTER TABLE. See `01-core-models.md` Resolved Decision #2.

4. **Message content compression: Postgres TOAST with LZ4** — Use Postgres automatic TOAST compression. Transparent to application code — no changes needed. Explicitly set LZ4 compression (`ALTER TABLE message_content ALTER COLUMN content SET COMPRESSION lz4`) for faster compress/decompress than default pglz. HL7v2 messages typically compress 3-5x. Pure win for the DB size problem that plagues Connect installations. Only downside (negligible): a few microseconds per read/write for compress/decompress.

5. **No separate read/write schemas** — Not needed. Postgres MVCC handles concurrent reads/writes without read locks. The hot path (insert message + connector messages + content) is append-only, which B-tree indexes handle efficiently. Partial index on `status = 'QUEUED'` keeps queue consumer queries fast. At expected volumes (few million messages/day = ~35/second), Postgres handles this trivially. The bottleneck is transformer sandbox execution (1-30ms), not database writes (~0.1-0.5ms). Skip this complexity entirely.
