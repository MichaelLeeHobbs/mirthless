// ===========================================
// Filter Rule Zod Schemas
// ===========================================

import { z } from 'zod/v4';

export const FILTER_RULE_TYPES = ['JAVASCRIPT', 'RULE_BUILDER'] as const;
export const FILTER_OPERATORS = ['AND', 'OR'] as const;

export const filterRuleInputSchema = z.object({
  enabled: z.boolean().default(true),
  name: z.string().max(255).optional(),
  operator: z.enum(FILTER_OPERATORS).default('AND'),
  type: z.enum(FILTER_RULE_TYPES),
  script: z.string().nullable().default(null),
  // Rule builder fields (null for JavaScript type)
  field: z.string().max(255).nullable().default(null),
  condition: z.string().max(50).nullable().default(null),
  values: z.array(z.string()).nullable().default(null),
});

export type FilterRuleInput = z.infer<typeof filterRuleInputSchema>;

export const filterInputSchema = z.object({
  connectorId: z.string().uuid().nullable().default(null),
  // metaDataId: used to resolve connectorId when destinations are being reinserted
  // null or absent = source filter, number = destination filter (maps to destination array index + 1)
  metaDataId: z.number().int().positive().nullable().default(null),
  rules: z.array(filterRuleInputSchema).default([]),
});

export type FilterInput = z.infer<typeof filterInputSchema>;
