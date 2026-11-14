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

/**
 * How a DELIMITED message is split into rows and columns. Kept on the source
 * transformer as `inboundProperties.delimited`; every field has a default, so
 * `{}` reads comma-separated lines with double-quote quoting.
 */
export const delimitedOptionsSchema = z.object({
  columnDelimiter: z.string().min(1).default(','),
  recordDelimiter: z.string().min(1).default('\n'),
  /** Quote character; empty turns quoting off. */
  quote: z.string().default('"'),
  /** A quote inside a quoted value is written twice (`""`); otherwise it is preceded by `quoteEscape`. */
  escapeWithDoubleQuote: z.boolean().default(true),
  quoteEscape: z.string().default('\\'),
  /** Names for the columns in order; a column past the list is `column<n>` (1-based). */
  columnNames: z.array(z.string().min(1)).default([]),
  /** Drop carriage returns, so CRLF files read like LF ones. */
  ignoreCR: z.boolean().default(true),
}).refine((o) => o.columnDelimiter !== o.recordDelimiter, { message: 'Column and record delimiters must differ' });

export type DelimitedOptions = z.infer<typeof delimitedOptionsSchema>;
