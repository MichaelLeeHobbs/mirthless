// ===========================================
// Connector Zod Schemas
// ===========================================

import { z } from 'zod/v4';

export const createDestinationConnectorSchema = z.object({
  name: z.string().min(1).max(255),
  enabled: z.boolean().default(true),
  connectorType: z.enum([
    'TCP_MLLP',
    'HTTP',
    'FILE',
    'DATABASE',
    'JAVASCRIPT',
    'CHANNEL',
    'DICOM',
    'SMTP',
    'FHIR',
  ]),
  properties: z.record(z.string(), z.unknown()),
  queueMode: z.enum(['NEVER', 'ON_FAILURE', 'ALWAYS']).default('NEVER'),
  retryCount: z.number().int().nonnegative().default(0),
  retryIntervalMs: z.number().int().nonnegative().default(10_000),
  rotateQueue: z.boolean().default(false),
  queueThreadCount: z.number().int().positive().default(1),
  waitForPrevious: z.boolean().default(false),
});

export type CreateDestinationConnectorInput = z.infer<typeof createDestinationConnectorSchema>;
