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

/** What is left out keeps what is stored; a new setting is a string in the category general (D-356). */
export const upsertSettingSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.string().nullable(),
  type: z.enum(['string', 'number', 'boolean', 'json', 'password']).optional(),
  description: z.string().nullable().optional(),
  category: z.string().max(100).optional(),
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
