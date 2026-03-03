// ===========================================
// User Preference Schemas
// ===========================================
// Zod validation schemas for user preference CRUD.

import { z } from 'zod/v4';

export const preferenceKeyParamSchema = z.object({
  key: z.string().min(1).max(255),
});

export type PreferenceKeyParam = z.infer<typeof preferenceKeyParamSchema>;

export const upsertPreferenceSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.string().nullable(),
});

export type UpsertPreferenceInput = z.infer<typeof upsertPreferenceSchema>;

export const bulkUpsertPreferencesSchema = z.object({
  entries: z.array(upsertPreferenceSchema).min(1).max(100),
});

export type BulkUpsertPreferencesInput = z.infer<typeof bulkUpsertPreferencesSchema>;
