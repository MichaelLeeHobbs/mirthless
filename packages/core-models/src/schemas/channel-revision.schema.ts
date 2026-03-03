// ===========================================
// Channel Revision Schemas
// ===========================================

import { z } from 'zod';

export const channelRevisionSummarySchema = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  revision: z.number().int().positive(),
  userId: z.string().uuid().nullable(),
  comment: z.string().nullable(),
  createdAt: z.string(),
});

export type ChannelRevisionSummary = z.infer<typeof channelRevisionSummarySchema>;

export const channelRevisionDetailSchema = channelRevisionSummarySchema.extend({
  snapshot: z.record(z.string(), z.unknown()),
});

export type ChannelRevisionDetail = z.infer<typeof channelRevisionDetailSchema>;

export const channelRevisionParamsSchema = z.object({
  id: z.string().uuid(),
  rev: z.coerce.number().int().positive(),
});
