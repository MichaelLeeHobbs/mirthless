import { z } from 'zod/v4';

export const globalMapKeyParamSchema = z.object({
  key: z.string().min(1).max(255),
});

export type GlobalMapKeyParam = z.infer<typeof globalMapKeyParamSchema>;

export const upsertGlobalMapEntrySchema = z.object({
  value: z.string(),
});

export type UpsertGlobalMapEntryInput = z.infer<typeof upsertGlobalMapEntrySchema>;
