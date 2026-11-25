import { z } from 'zod/v4';
import { scriptLanguageSchema } from './script-language.schema.js';
import { idSchema } from './id.schema.js';

export const FILTER_RULE_TYPES = ['JAVASCRIPT', 'RULE_BUILDER'] as const;
export const FILTER_OPERATORS = ['AND', 'OR'] as const;

export const filterRuleInputSchema = z.object({
  enabled: z.boolean().default(true),
  name: z.string().max(255).optional(),
  operator: z.enum(FILTER_OPERATORS).default('AND'),
  type: z.enum(FILTER_RULE_TYPES),
  script: z.string().nullable().default(null),
  /** Create stores JavaScript when it is left out; update requires it with a script (D-294). */
  language: scriptLanguageSchema.optional(),
  // Rule builder only; null for JAVASCRIPT.
  field: z.string().max(255).nullable().default(null),
  condition: z.string().max(50).nullable().default(null),
  values: z.array(z.string()).nullable().default(null),
});

export type FilterRuleInput = z.infer<typeof filterRuleInputSchema>;

export const filterInputSchema = z.object({
  connectorId: idSchema.nullable().default(null),
  // null: the source's filter; a number: destination array index + 1, resolving connectorId when destinations are reinserted.
  metaDataId: z.number().int().positive().nullable().default(null),
  rules: z.array(filterRuleInputSchema).default([]),
});

export type FilterInput = z.infer<typeof filterInputSchema>;
