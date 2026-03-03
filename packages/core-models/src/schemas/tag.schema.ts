// ===========================================
// Channel Tag Zod Schemas
// ===========================================

import { z } from 'zod/v4';

// ----- Tag CRUD -----

export const createTagSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a valid hex color (e.g. #FF0000)'),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a valid hex color (e.g. #FF0000)').optional(),
});

export type UpdateTagInput = z.infer<typeof updateTagSchema>;

// ----- Assignment -----

export const assignTagSchema = z.object({
  channelId: z.string().uuid(),
});

export type AssignTagInput = z.infer<typeof assignTagSchema>;

// ----- Params -----

export const tagUuidParamSchema = z.object({
  id: z.string().uuid(),
});

export const tagChannelParamSchema = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
});
