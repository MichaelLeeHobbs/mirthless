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

/** Body for POST /channels/:id/messages/bulk-reprocess. */
export const bulkReprocessInputSchema = z.object({
  messageIds: z.array(z.number().int().positive()).min(1).max(500),
});

export type BulkReprocessInput = z.infer<typeof bulkReprocessInputSchema>;

/** Params for POST /channels/:id/messages/:msgId/connectors/:metaDataId/resend. */
export const resendParamsSchema = z.object({
  id: z.string().uuid(),
  msgId: z.coerce.number().int().positive(),
  metaDataId: z.coerce.number().int().nonnegative(),
});

export type ResendParams = z.infer<typeof resendParamsSchema>;
