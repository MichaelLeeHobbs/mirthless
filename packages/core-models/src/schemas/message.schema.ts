// ===========================================
// Message Zod Schemas
// ===========================================

import { z } from 'zod/v4';

export const messageSearchSchema = z.object({
  channelId: z.string().uuid(),
  status: z
    .enum(['RECEIVED', 'FILTERED', 'TRANSFORMED', 'SENT', 'QUEUED', 'ERROR', 'PENDING'])
    .optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  textSearch: z.string().optional(),
  metaDataId: z.coerce.number().int().nonnegative().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type MessageSearchInput = z.infer<typeof messageSearchSchema>;
