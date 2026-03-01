// ===========================================
// Channel Import/Export Schemas
// ===========================================
// Zod schemas for channel export/import payloads.

import { z } from 'zod/v4';

// ----- Export Schema -----

const channelExportFilterRuleSchema = z.object({
  enabled: z.boolean(),
  name: z.string().nullable(),
  operator: z.string(),
  type: z.string(),
  script: z.string().nullable(),
  field: z.string().nullable(),
  condition: z.string().nullable(),
  values: z.array(z.string()).nullable(),
});

const channelExportFilterSchema = z.object({
  connectorId: z.string().nullable(),
  rules: z.array(channelExportFilterRuleSchema),
});

const channelExportTransformerStepSchema = z.object({
  enabled: z.boolean(),
  name: z.string().nullable(),
  type: z.string(),
  script: z.string().nullable(),
  sourceField: z.string().nullable(),
  targetField: z.string().nullable(),
  defaultValue: z.string().nullable(),
  mapping: z.string().nullable(),
});

const channelExportTransformerSchema = z.object({
  connectorId: z.string().nullable(),
  inboundDataType: z.string(),
  outboundDataType: z.string(),
  inboundProperties: z.record(z.string(), z.unknown()),
  outboundProperties: z.record(z.string(), z.unknown()),
  inboundTemplate: z.string().nullable(),
  outboundTemplate: z.string().nullable(),
  steps: z.array(channelExportTransformerStepSchema),
});

const channelExportDestinationSchema = z.object({
  metaDataId: z.number(),
  name: z.string(),
  enabled: z.boolean(),
  connectorType: z.string(),
  properties: z.record(z.string(), z.unknown()),
  queueMode: z.string(),
  retryCount: z.number(),
  retryIntervalMs: z.number(),
  rotateQueue: z.boolean(),
  queueThreadCount: z.number(),
  waitForPrevious: z.boolean(),
});

const channelExportScriptSchema = z.object({
  scriptType: z.string(),
  script: z.string(),
});

const channelExportMetadataColumnSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  mappingExpression: z.string().nullable(),
});

const channelExportEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  revision: z.number(),
  inboundDataType: z.string(),
  outboundDataType: z.string(),
  sourceConnectorType: z.string(),
  sourceConnectorProperties: z.record(z.string(), z.unknown()),
  responseMode: z.string(),
  responseConnectorName: z.string().nullable(),
  initialState: z.string(),
  messageStorageMode: z.string(),
  encryptData: z.boolean(),
  removeContentOnCompletion: z.boolean(),
  removeAttachmentsOnCompletion: z.boolean(),
  pruningEnabled: z.boolean(),
  pruningMaxAgeDays: z.number().nullable(),
  pruningArchiveEnabled: z.boolean(),
  scripts: z.array(channelExportScriptSchema),
  destinations: z.array(channelExportDestinationSchema),
  metadataColumns: z.array(channelExportMetadataColumnSchema),
  filters: z.array(channelExportFilterSchema),
  transformers: z.array(channelExportTransformerSchema),
});

export const channelExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  channels: z.array(channelExportEntrySchema),
});

export type ChannelExport = z.infer<typeof channelExportSchema>;
export type ChannelExportEntry = z.infer<typeof channelExportEntrySchema>;

// ----- Import Schema -----

const COLLISION_MODE = {
  SKIP: 'SKIP',
  OVERWRITE: 'OVERWRITE',
  CREATE_NEW: 'CREATE_NEW',
} as const;
type CollisionMode = typeof COLLISION_MODE[keyof typeof COLLISION_MODE];

export { COLLISION_MODE };
export type { CollisionMode };

export const channelImportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  channels: z.array(channelExportEntrySchema),
  collisionMode: z.enum(['SKIP', 'OVERWRITE', 'CREATE_NEW']),
});

export type ChannelImportInput = z.infer<typeof channelImportSchema>;

/** Result of an import operation. */
export interface ImportResult {
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly errors: readonly string[];
}
