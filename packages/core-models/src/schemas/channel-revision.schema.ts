import { z } from 'zod';
import { idSchema } from './id.schema.js';

export const channelRevisionSummarySchema = z.object({
  id: idSchema,
  channelId: idSchema,
  revision: z.number().int().positive(),
  userId: idSchema.nullable(),
  comment: z.string().nullable(),
  createdAt: z.string(),
});

export type ChannelRevisionSummary = z.infer<typeof channelRevisionSummarySchema>;

export const channelRevisionDetailSchema = channelRevisionSummarySchema.extend({
  snapshot: z.record(z.string(), z.unknown()),
});

export type ChannelRevisionDetail = z.infer<typeof channelRevisionDetailSchema>;

export const channelRevisionParamsSchema = z.object({
  id: idSchema,
  rev: z.coerce.number().int().positive(),
});
