import { z } from 'zod/v4';
import { idSchema } from './id.schema.js';

export const createResourceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().default(''),
  mimeType: z.string().min(1).max(100),
  content: z.string(),
});

export type CreateResourceInput = z.infer<typeof createResourceSchema>;

export const updateResourceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  mimeType: z.string().min(1).max(100).optional(),
  content: z.string().optional(),
});

export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;

export const resourceUuidParamSchema = z.object({
  id: idSchema,
});
