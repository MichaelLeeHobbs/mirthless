// ===========================================
// Message Reprocessing Schemas
// ===========================================

import { z } from 'zod';

export const reprocessParamsSchema = z.object({
  id: z.string().uuid(),
  msgId: z.coerce.number().int().positive(),
});

export type ReprocessParams = z.infer<typeof reprocessParamsSchema>;

export const bulkDeleteInputSchema = z.object({
  messageIds: z.array(z.number().int().positive()).min(1).max(1000),
});

export type BulkDeleteInput = z.infer<typeof bulkDeleteInputSchema>;

export const bulkDeleteParamsSchema = z.object({
  id: z.string().uuid(),
});
