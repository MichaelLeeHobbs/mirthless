// ===========================================
// Transformer Step Zod Schemas
// ===========================================

import { z } from 'zod/v4';
import { scriptLanguageSchema } from './script-language.schema.js';

export const TRANSFORMER_STEP_TYPES = ['JAVASCRIPT', 'MAPPER', 'MESSAGE_BUILDER'] as const;

export const transformerStepInputSchema = z.object({
  enabled: z.boolean().default(true),
  name: z.string().max(255).optional(),
  type: z.enum(TRANSFORMER_STEP_TYPES),
  script: z.string().nullable().default(null),
  /** The language of `script`. Create stores JavaScript when it is left out; update requires it with a script (D-294). */
  language: scriptLanguageSchema.optional(),
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
  /**
   * Quote character. Never empty: without quoting, a value holding a delimiter
   * would be written as two columns and read back wrong.
   */
  quote: z.string().min(1).default('"'),
  /** A quote inside a quoted value is written twice (`""`); otherwise it is preceded by `quoteEscape`, which is itself written twice. */
  escapeWithDoubleQuote: z.boolean().default(true),
  quoteEscape: z.string().min(1).default('\\'),
  /** Names for the columns in order; a column past the list is `column<n>` (1-based). */
  columnNames: z.array(z.string().min(1)).default([]),
  /** Drop carriage returns, so CRLF files read like LF ones. */
  ignoreCR: z.boolean().default(true),
})
  .refine((o) => o.columnDelimiter !== o.recordDelimiter, { message: 'Column and record delimiters must differ' })
  .refine((o) => o.quote !== o.columnDelimiter && o.quote !== o.recordDelimiter, { message: 'The quote cannot be a delimiter' })
  // Two columns with one name would make a row object keep only the last.
  .refine((o) => new Set(o.columnNames).size === o.columnNames.length, { message: 'Column names must be unique' });

export type DelimitedOptions = z.infer<typeof delimitedOptionsSchema>;
