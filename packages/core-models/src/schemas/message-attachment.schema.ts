import { z } from 'zod/v4';
import { idSchema } from './id.schema.js';

export const attachmentListParamsSchema = z.object({
  id: idSchema,
  msgId: z.string().regex(/^\d+$/),
});

export type AttachmentListParams = z.infer<typeof attachmentListParamsSchema>;

export const attachmentGetParamsSchema = z.object({
  id: idSchema,
  msgId: z.string().regex(/^\d+$/),
  attachmentId: z.string().min(1).max(255),
});

export type AttachmentGetParams = z.infer<typeof attachmentGetParamsSchema>;
