import { z } from 'zod/v4';
import { exportReasonSchema } from './audit.schema.js';

const EXPORT_FORMAT = {
  CSV: 'csv',
  JSON: 'json',
} as const;

type ExportFormat = (typeof EXPORT_FORMAT)[keyof typeof EXPORT_FORMAT];

export const eventExportQuerySchema = z.object({
  format: z.enum(['csv', 'json']),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  level: z.string().optional(),
  name: z.string().optional(),
  outcome: z.string().optional(),
  maxRows: z.coerce.number().int().positive().max(50_000).default(10_000),
  reason: exportReasonSchema,
});

export type EventExportQuery = z.infer<typeof eventExportQuerySchema>;

export { EXPORT_FORMAT, type ExportFormat };
