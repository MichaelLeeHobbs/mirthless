import { z } from 'zod/v4';
import { idSchema } from './id.schema.js';

export const setDependenciesSchema = z.object({
  dependsOnChannelIds: z.array(idSchema),
});

export type SetDependenciesInput = z.infer<typeof setDependenciesSchema>;

export const channelDependencyParamSchema = z.object({
  id: idSchema,
});
