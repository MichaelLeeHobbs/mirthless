// ===========================================
// Setting Zod Schemas
// ===========================================
// Validation schemas for system settings CRUD.

import { z } from 'zod/v4';

// ----- Const Objects -----

export const SETTING_TYPE = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  JSON: 'json',
} as const;

export type SettingType = (typeof SETTING_TYPE)[keyof typeof SETTING_TYPE];

// ----- Upsert Schema -----

/** Used for both create and update (keyed by unique `key`). */
export const upsertSettingSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.string().nullable().default(null),
  type: z.enum(['string', 'number', 'boolean', 'json']).default('string'),
  description: z.string().nullable().default(null),
  category: z.string().max(100).default('general'),
});

export type UpsertSettingInput = z.infer<typeof upsertSettingSchema>;

// ----- Bulk Upsert Schema -----

/** Settings page "Save All". */
export const bulkUpsertSettingsSchema = z.object({
  settings: z.array(upsertSettingSchema).min(1),
});

export type BulkUpsertSettingsInput = z.infer<typeof bulkUpsertSettingsSchema>;

// ----- List Query Schema -----

/** Optional category filter for GET /settings. */
export const settingsListQuerySchema = z.object({
  category: z.string().optional(),
});

export type SettingsListQuery = z.infer<typeof settingsListQuerySchema>;

// ----- Param Schema -----

/** Key-based lookup for GET/PUT/DELETE /settings/:key. */
export const settingKeyParamSchema = z.object({
  key: z.string().min(1).max(255),
});

export type SettingKeyParam = z.infer<typeof settingKeyParamSchema>;
