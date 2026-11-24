import { z } from 'zod/v4';

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
  messageId: z.coerce.number().int().positive().optional(),
  contentSearch: z.string().max(500).optional(),
  /** A custom metadata column: with metaDataValue, messages whose column equals it; alone, messages that have the column. */
  metaDataColumn: z.string().min(1).max(255).optional(),
  metaDataValue: z.string().max(500).optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
  sort: z.enum(['receivedAt', 'messageId', 'status']).default('receivedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export type MessageSearchQuery = z.infer<typeof messageSearchQuerySchema>;
