// ===========================================
// Event Export Zod Schemas
// ===========================================
// Validation schemas for exporting audit events as CSV or JSON.

import { z } from 'zod/v4';

// ----- Const Objects -----

const EXPORT_FORMAT = {
  CSV: 'csv',
  JSON: 'json',
} as const;

type ExportFormat = (typeof EXPORT_FORMAT)[keyof typeof EXPORT_FORMAT];

// ----- Query Schema -----

/** GET /events/export query string params. */
export const eventExportQuerySchema = z.object({
  format: z.enum(['csv', 'json']),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  level: z.string().optional(),
  name: z.string().optional(),
  outcome: z.string().optional(),
  maxRows: z.coerce.number().int().positive().max(50_000).default(10_000),
});

export type EventExportQuery = z.infer<typeof eventExportQuerySchema>;

export { EXPORT_FORMAT, type ExportFormat };
