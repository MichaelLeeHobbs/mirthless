import { z } from 'zod/v4';

export const SETTING_TYPE = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  JSON: 'json',
  /** Masked in GET responses: write-only. */
  PASSWORD: 'password',
} as const;

export type SettingType = (typeof SETTING_TYPE)[keyof typeof SETTING_TYPE];

export const upsertSettingSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.string().nullable().default(null),
  type: z.enum(['string', 'number', 'boolean', 'json', 'password']).default('string'),
  description: z.string().nullable().default(null),
  category: z.string().max(100).default('general'),
});

export type UpsertSettingInput = z.infer<typeof upsertSettingSchema>;

export const bulkUpsertSettingsSchema = z.object({
  settings: z.array(upsertSettingSchema).min(1),
});

export type BulkUpsertSettingsInput = z.infer<typeof bulkUpsertSettingsSchema>;

export const settingsListQuerySchema = z.object({
  category: z.string().optional(),
});

export type SettingsListQuery = z.infer<typeof settingsListQuerySchema>;

export const settingKeyParamSchema = z.object({
  key: z.string().min(1).max(255),
});

export type SettingKeyParam = z.infer<typeof settingKeyParamSchema>;
