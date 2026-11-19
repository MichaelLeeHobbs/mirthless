import { z } from 'zod/v4';
import { exportReasonSchema } from './audit.schema.js';

const STATUS_VALUES = ['RECEIVED', 'FILTERED', 'TRANSFORMED', 'SENT', 'QUEUED', 'ERROR', 'PENDING'] as const;

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
  // Decrypted raw content (PHI), audited. Parsed explicitly so the query string "false" is not coerced to true.
  includeContent: z
    .preprocess((v) => v === 'true' || v === true || v === '1', z.boolean())
    .default(false),
  reason: exportReasonSchema,
});

export type MessageExportQuery = z.infer<typeof messageExportQuerySchema>;
