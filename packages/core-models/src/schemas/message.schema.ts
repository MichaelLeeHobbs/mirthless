// ===========================================
// Message Zod Schemas
// ===========================================

import { z } from 'zod/v4';

/** Query params for message search endpoint (GET /channels/:id/messages). */
export const messageSearchQuerySchema = z.object({
  status: z
    .union([
      z.enum(['RECEIVED', 'FILTERED', 'TRANSFORMED', 'SENT', 'QUEUED', 'ERROR', 'PENDING']),
      z.array(z.enum(['RECEIVED', 'FILTERED', 'TRANSFORMED', 'SENT', 'QUEUED', 'ERROR', 'PENDING'])),
    ])
    .optional()
    .transform((val) => {
      if (val === undefined) return undefined;
      return Array.isArray(val) ? val : [val];
    }),
  receivedFrom: z.coerce.date().optional(),
  receivedTo: z.coerce.date().optional(),
  metaDataId: z.coerce.number().int().nonnegative().optional(),
  contentSearch: z.string().max(500).optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
  sort: z.enum(['receivedAt', 'messageId', 'status']).default('receivedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export type MessageSearchQuery = z.infer<typeof messageSearchQuerySchema>;

/** Backward-compatible schema for internal use. */
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
