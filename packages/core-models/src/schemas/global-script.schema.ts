// ===========================================
// Global Script Zod Schemas
// ===========================================

import { z } from 'zod/v4';
import { scriptLanguageSchema } from './script-language.schema.js';

export const updateGlobalScriptsSchema = z.object({
  deploy: z.string().optional(),
  undeploy: z.string().optional(),
  preprocessor: z.string().optional(),
  postprocessor: z.string().optional(),
  /** The language of each script; a script left out keeps its language. */
  languages: z.object({
    deploy: scriptLanguageSchema.optional(),
    undeploy: scriptLanguageSchema.optional(),
    preprocessor: scriptLanguageSchema.optional(),
    postprocessor: scriptLanguageSchema.optional(),
  }).optional(),
});

export type UpdateGlobalScriptsInput = z.infer<typeof updateGlobalScriptsSchema>;
