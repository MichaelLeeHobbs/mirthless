// ===========================================
// Server Backup/Restore Schemas
// ===========================================
// Zod schemas for full server backup and restore payloads.

import { z } from 'zod/v4';
import { channelExportEntrySchema } from './channel-export.schema.js';

// ----- Collision Mode -----

const BACKUP_COLLISION_MODE = {
  SKIP: 'SKIP',
  OVERWRITE: 'OVERWRITE',
} as const;
type BackupCollisionMode = typeof BACKUP_COLLISION_MODE[keyof typeof BACKUP_COLLISION_MODE];

export { BACKUP_COLLISION_MODE };
export type { BackupCollisionMode };

// ----- Backup Entity Schemas -----

const backupUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  description: z.string().nullable(),
  role: z.string(),
  enabled: z.boolean(),
});

export type BackupUser = z.infer<typeof backupUserSchema>;

const backupSettingSchema = z.object({
  key: z.string(),
  value: z.string().nullable(),
  type: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
});

const backupCodeTemplateLibrarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
});

const backupCodeTemplateSchema = z.object({
  id: z.string().uuid(),
  libraryId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.string(),
  code: z.string(),
  contexts: z.array(z.string()),
});

const backupAlertActionSchema = z.object({
  actionType: z.string(),
  recipients: z.array(z.string()),
  properties: z.record(z.string(), z.unknown()).nullable(),
});

const backupAlertSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  trigger: z.object({
    type: z.string(),
    errorTypes: z.array(z.string()),
    regex: z.string().nullable(),
  }),
  channelIds: z.array(z.string().uuid()),
  actions: z.array(backupAlertActionSchema),
  subjectTemplate: z.string().nullable(),
  bodyTemplate: z.string().nullable(),
  reAlertIntervalMs: z.number().nullable(),
  maxAlerts: z.number().nullable(),
});

const backupGlobalScriptsSchema = z.object({
  deploy: z.string(),
  undeploy: z.string(),
  preprocessor: z.string(),
  postprocessor: z.string(),
});

const backupResourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  mimeType: z.string().nullable(),
  content: z.string().nullable(),
});

const backupChannelGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
});

const backupTagSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string().nullable(),
});

const backupChannelDependencySchema = z.object({
  channelId: z.string().uuid(),
  dependsOnChannelId: z.string().uuid(),
});

const backupConfigMapEntrySchema = z.object({
  category: z.string(),
  name: z.string(),
  value: z.string().nullable(),
});

const backupGlobalMapEntrySchema = z.object({
  key: z.string(),
  value: z.string().nullable(),
});

const backupGroupMembershipSchema = z.object({
  channelGroupId: z.string().uuid(),
  channelId: z.string().uuid(),
});

const backupTagAssignmentSchema = z.object({
  tagId: z.string().uuid(),
  channelId: z.string().uuid(),
});

// ----- Server Backup Schema -----

export const serverBackupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  channels: z.array(channelExportEntrySchema),
  codeTemplateLibraries: z.array(backupCodeTemplateLibrarySchema),
  codeTemplates: z.array(backupCodeTemplateSchema),
  alerts: z.array(backupAlertSchema),
  globalScripts: backupGlobalScriptsSchema,
  users: z.array(backupUserSchema),
  settings: z.array(backupSettingSchema),
  resources: z.array(backupResourceSchema),
  channelGroups: z.array(backupChannelGroupSchema),
  tags: z.array(backupTagSchema),
  channelDependencies: z.array(backupChannelDependencySchema),
  configMap: z.array(backupConfigMapEntrySchema),
  globalMap: z.array(backupGlobalMapEntrySchema),
  groupMemberships: z.array(backupGroupMembershipSchema),
  tagAssignments: z.array(backupTagAssignmentSchema),
});

export type ServerBackup = z.infer<typeof serverBackupSchema>;

// ----- Restore Input Schema -----

export const serverRestoreInputSchema = z.object({
  backup: serverBackupSchema,
  collisionMode: z.enum(['SKIP', 'OVERWRITE']),
});

export type ServerRestoreInput = z.infer<typeof serverRestoreInputSchema>;

// ----- Restore Result -----

export interface RestoreSectionResult {
  readonly section: string;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly errors: readonly string[];
}

export interface ServerRestoreResult {
  readonly sections: readonly RestoreSectionResult[];
  readonly totalCreated: number;
  readonly totalUpdated: number;
  readonly totalSkipped: number;
  readonly totalErrors: number;
}
