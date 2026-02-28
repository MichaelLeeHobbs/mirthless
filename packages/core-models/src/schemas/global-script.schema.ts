// ===========================================
// Global Script Zod Schemas
// ===========================================

import { z } from 'zod/v4';

export const updateGlobalScriptsSchema = z.object({
  deploy: z.string().optional(),
  undeploy: z.string().optional(),
  preprocessor: z.string().optional(),
  postprocessor: z.string().optional(),
});

export type UpdateGlobalScriptsInput = z.infer<typeof updateGlobalScriptsSchema>;
