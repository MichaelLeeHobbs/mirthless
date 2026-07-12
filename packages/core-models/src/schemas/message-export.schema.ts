// ===========================================
// Message Export Zod Schemas
// ===========================================
// Query params for GET /channels/:id/messages/export.

import { z } from 'zod/v4';

const STATUS_VALUES = ['RECEIVED', 'FILTERED', 'TRANSFORMED', 'SENT', 'QUEUED', 'ERROR', 'PENDING'] as const;

/**
 * Query string for the message metadata export endpoint. Mirrors the message
 * browser list filters (status, date range) plus export-specific controls
 * (format, row cap, optional PHI content inclusion).
 */
export const messageExportQuerySchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  status: z
    .union([z.enum(STATUS_VALUES), z.array(z.enum(STATUS_VALUES))])
    .optional()
    .transform((val) => {
      if (val === undefined) return undefined;
      return Array.isArray(val) ? val : [val];
    }),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  // Hard cap of 10k rows keeps a metadata export bounded and memory-safe.
  limit: z.coerce.number().int().positive().max(10_000).default(10_000),
  // When true, include the decrypted raw source content column (PHI). Audited.
  // Parsed explicitly so the query string "false" is not coerced to true.
  includeContent: z
    .preprocess((v) => v === 'true' || v === true || v === '1', z.boolean())
    .default(false),
});

export type MessageExportQuery = z.infer<typeof messageExportQuerySchema>;
