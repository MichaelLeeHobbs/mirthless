// ===========================================
// Channel Group Zod Schemas
// ===========================================

import { z } from 'zod/v4';

// ----- Group CRUD -----

export const createChannelGroupSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().default(''),
});

export type CreateChannelGroupInput = z.infer<typeof createChannelGroupSchema>;

export const updateChannelGroupSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  revision: z.number().int().positive(),
});

export type UpdateChannelGroupInput = z.infer<typeof updateChannelGroupSchema>;

// ----- Member Management -----

/**
 * The full set of groups a channel belongs to, replacing what it had. An empty
 * list takes the channel out of every group.
 */
export const SET_CHANNEL_GROUPS_MAX = 1000;

export const setChannelGroupsSchema = z.object({
  // Lowercased so an id matches the stored group and the repeat check sees an upper/lower pair as one.
  groupIds: z.array(z.string().uuid().transform((id) => id.toLowerCase()))
    .max(SET_CHANNEL_GROUPS_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'groupIds must not repeat a group' }),
});

export type SetChannelGroupsInput = z.infer<typeof setChannelGroupsSchema>;

// ----- Params -----

export const channelGroupUuidParamSchema = z.object({
  id: z.string().uuid(),
});
