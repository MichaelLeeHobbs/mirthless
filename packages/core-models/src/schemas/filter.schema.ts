import { z } from 'zod/v4';
import { scriptLanguageSchema } from './script-language.schema.js';

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

/** An `id` a channel request gives a destination. Lower case, as the stored ids it is compared with. */
export const destinationRefSchema = z.string().min(1).max(64).toLowerCase();

/** Which connector a filter or transformer is for. Both null: the source. */
export const connectorRefFields = {
  /** The `id` that a destination has in the same request. */
  connectorId: destinationRefSchema.nullable().default(null),
  /** Create only: the destination's place in the request's list, from 1. */
  metaDataId: z.number().int().positive().nullable().default(null),
} as const;

export const filterInputSchema = z.object({
  ...connectorRefFields,
  rules: z.array(filterRuleInputSchema).default([]),
});

export type FilterInput = z.infer<typeof filterInputSchema>;
