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

export const addChannelGroupMemberSchema = z.object({
  channelId: z.string().uuid(),
});

export type AddChannelGroupMemberInput = z.infer<typeof addChannelGroupMemberSchema>;

// ----- Params -----

export const channelGroupUuidParamSchema = z.object({
  id: z.string().uuid(),
});

export const channelGroupMemberParamSchema = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
});
