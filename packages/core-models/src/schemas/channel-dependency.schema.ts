// ===========================================
// Channel Dependency Zod Schemas
// ===========================================

import { z } from 'zod/v4';

// ----- Set Dependencies -----

export const setDependenciesSchema = z.object({
  dependsOnChannelIds: z.array(z.string().uuid()),
});

export type SetDependenciesInput = z.infer<typeof setDependenciesSchema>;

// ----- Params -----

export const channelDependencyParamSchema = z.object({
  id: z.string().uuid(),
});
