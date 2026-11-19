import { z } from 'zod/v4';

export const setDependenciesSchema = z.object({
  dependsOnChannelIds: z.array(z.string().uuid()),
});

export type SetDependenciesInput = z.infer<typeof setDependenciesSchema>;

export const channelDependencyParamSchema = z.object({
  id: z.string().uuid(),
});
