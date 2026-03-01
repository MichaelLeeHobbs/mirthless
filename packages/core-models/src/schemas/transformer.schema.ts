// ===========================================
// Transformer Step Zod Schemas
// ===========================================

import { z } from 'zod/v4';

export const TRANSFORMER_STEP_TYPES = ['JAVASCRIPT', 'MAPPER', 'MESSAGE_BUILDER'] as const;

export const transformerStepInputSchema = z.object({
  enabled: z.boolean().default(true),
  name: z.string().max(255).optional(),
  type: z.enum(TRANSFORMER_STEP_TYPES),
  script: z.string().nullable().default(null),
  // Mapper fields (null for other types)
  sourceField: z.string().max(500).nullable().default(null),
  targetField: z.string().max(500).nullable().default(null),
  defaultValue: z.string().nullable().default(null),
  mapping: z.string().max(30).nullable().default(null),
});

export type TransformerStepInput = z.infer<typeof transformerStepInputSchema>;

export const transformerInputSchema = z.object({
  connectorId: z.string().uuid().nullable().default(null),
  // metaDataId: used to resolve connectorId when destinations are being reinserted
  metaDataId: z.number().int().positive().nullable().default(null),
  inboundDataType: z.string().max(50).default('HL7V2'),
  outboundDataType: z.string().max(50).default('HL7V2'),
  inboundProperties: z.record(z.string(), z.unknown()).default({}),
  outboundProperties: z.record(z.string(), z.unknown()).default({}),
  inboundTemplate: z.string().nullable().default(null),
  outboundTemplate: z.string().nullable().default(null),
  steps: z.array(transformerStepInputSchema).default([]),
});

export type TransformerInput = z.infer<typeof transformerInputSchema>;
