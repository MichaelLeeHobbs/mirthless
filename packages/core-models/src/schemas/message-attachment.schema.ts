// ===========================================
// Message Attachment Schemas
// ===========================================
// Zod validation schemas for attachment route params.

import { z } from 'zod/v4';

export const attachmentListParamsSchema = z.object({
  id: z.string().uuid(),
  msgId: z.string().regex(/^\d+$/),
});

export type AttachmentListParams = z.infer<typeof attachmentListParamsSchema>;

export const attachmentGetParamsSchema = z.object({
  id: z.string().uuid(),
  msgId: z.string().regex(/^\d+$/),
  attachmentId: z.string().min(1).max(255),
});

export type AttachmentGetParams = z.infer<typeof attachmentGetParamsSchema>;
