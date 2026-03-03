// ===========================================
// Configuration Map Schemas
// ===========================================
// Zod validation schemas for categorized configuration map.

import { z } from 'zod/v4';

export const configMapParamSchema = z.object({
  category: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
});

export type ConfigMapParam = z.infer<typeof configMapParamSchema>;

export const configMapQuerySchema = z.object({
  category: z.string().min(1).max(100).optional(),
});

export type ConfigMapQuery = z.infer<typeof configMapQuerySchema>;

export const upsertConfigMapEntrySchema = z.object({
  value: z.string(),
});

export type UpsertConfigMapEntryInput = z.infer<typeof upsertConfigMapEntrySchema>;

export const bulkUpsertConfigMapSchema = z.object({
  entries: z.array(z.object({
    category: z.string().min(1).max(100),
    name: z.string().min(1).max(255),
    value: z.string(),
  })).min(1),
});

export type BulkUpsertConfigMapInput = z.infer<typeof bulkUpsertConfigMapSchema>;
