import { z } from 'zod/v4';
import { channelExportEntrySchema } from './channel-export.schema.js';
import { codeTemplateLanguageSchema } from './code-template.schema.js';
import { updateGlobalScriptsSchema } from './global-script.schema.js';
import { idSchema } from './id.schema.js';

const BACKUP_COLLISION_MODE = {
  SKIP: 'SKIP',
  OVERWRITE: 'OVERWRITE',
} as const;
type BackupCollisionMode = typeof BACKUP_COLLISION_MODE[keyof typeof BACKUP_COLLISION_MODE];

export { BACKUP_COLLISION_MODE };
export type { BackupCollisionMode };

const backupUserSchema = z.object({
  id: idSchema,
  username: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  description: z.string().nullable(),
  roles: z.array(z.string()).optional(),
  /** The one role a user held in a backup made before roles were rows. */
  role: z.string().optional(),
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
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  /** Absent in backups made before libraries could be scoped: every channel. */
  channelIds: z.array(idSchema).nullable().optional(),
});

const backupCodeTemplateSchema = z.object({
  id: idSchema,
  libraryId: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  type: z.string(),
  /** Absent in backups made before it was carried (#419). */
  language: codeTemplateLanguageSchema.optional(),
  code: z.string(),
  contexts: z.array(z.string()),
});

const backupAlertActionSchema = z.object({
  actionType: z.string(),
  recipients: z.array(z.string()),
  properties: z.record(z.string(), z.unknown()).nullable(),
});

const backupAlertSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  trigger: z.object({
    type: z.string(),
    errorTypes: z.array(z.string()),
    regex: z.string().nullable(),
    // NO_MESSAGES triggers; absent in backups made before that trigger existed.
    windowMinutes: z.number().int().nullable().optional(),
  }),
  channelIds: z.array(idSchema),
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
  // Optional: backups taken before languages were stored restore as JavaScript.
  languages: updateGlobalScriptsSchema.shape.languages,
});

const backupResourceSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  mimeType: z.string().nullable(),
  content: z.string().nullable(),
});

const backupChannelGroupSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
});

const backupTagSchema = z.object({
  id: idSchema,
  name: z.string(),
  color: z.string().nullable(),
});

const backupChannelDependencySchema = z.object({
  channelId: idSchema,
  dependsOnChannelId: idSchema,
});

const backupConfigMapEntrySchema = z.object({
  category: z.string(),
  name: z.string(),
  value: z.string().nullable(),
});

const backupGlobalMapEntrySchema = z.object({
  key: z.string(),
  value: z.string().nullable(),
  /** True when a script stored a non-text value as JSON. Absent in older backups. */
  isJson: z.boolean().default(false),
});

const backupGroupMembershipSchema = z.object({
  channelGroupId: idSchema,
  channelId: idSchema,
});

const backupTagAssignmentSchema = z.object({
  tagId: idSchema,
  channelId: idSchema,
});

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

export const serverRestoreInputSchema = z.object({
  backup: serverBackupSchema,
  collisionMode: z.enum(['SKIP', 'OVERWRITE']),
});

export type ServerRestoreInput = z.infer<typeof serverRestoreInputSchema>;

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
