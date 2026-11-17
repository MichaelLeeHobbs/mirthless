// ===========================================
// Connection Test Schemas
// ===========================================
// Zod validation schemas for connector connection testing.

import { z } from 'zod/v4';
import { CONNECTOR_TYPES } from '../constants.js';

const CONNECTOR_MODE_VALUES = [
  'SOURCE',
  'DESTINATION',
] as const;

export const connectionTestSchema = z.object({
  connectorType: z.enum(CONNECTOR_TYPES),
  mode: z.enum(CONNECTOR_MODE_VALUES),
  properties: z.record(z.string(), z.unknown()),
  /** The channel the test is for; required of a deployer scoped to some groups (D-310). */
  channelId: z.string().uuid().optional(),
});

export type ConnectionTestInput = z.infer<typeof connectionTestSchema>;

export interface ConnectionTestResult {
  readonly success: boolean;
  readonly message: string;
  readonly latencyMs: number;
}
