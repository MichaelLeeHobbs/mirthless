// ===========================================
// Connection Test Schemas
// ===========================================
// Zod validation schemas for connector connection testing.

import { z } from 'zod/v4';

const CONNECTOR_TYPE_VALUES = [
  'TCP_MLLP',
  'HTTP',
  'FILE',
  'DATABASE',
  'JAVASCRIPT',
  'CHANNEL',
  'DICOM',
  'SMTP',
  'FHIR',
  'EMAIL',
] as const;

const CONNECTOR_MODE_VALUES = [
  'SOURCE',
  'DESTINATION',
] as const;

export const connectionTestSchema = z.object({
  connectorType: z.enum(CONNECTOR_TYPE_VALUES),
  mode: z.enum(CONNECTOR_MODE_VALUES),
  properties: z.record(z.string(), z.unknown()),
});

export type ConnectionTestInput = z.infer<typeof connectionTestSchema>;

export interface ConnectionTestResult {
  readonly success: boolean;
  readonly message: string;
  readonly latencyMs: number;
}
