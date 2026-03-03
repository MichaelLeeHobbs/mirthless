// ===========================================
// Cross-Channel Search Schemas
// ===========================================

import { z } from 'zod';
import { MESSAGE_STATUS } from '../constants.js';

const messageStatusValues = Object.values(MESSAGE_STATUS) as [string, ...string[]];

export const crossChannelSearchQuerySchema = z.object({
  status: z.enum(messageStatusValues).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  channelIds: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(25),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type CrossChannelSearchQuery = z.infer<typeof crossChannelSearchQuerySchema>;

export const crossChannelSearchResultSchema = z.object({
  items: z.array(z.object({
    messageId: z.number(),
    channelId: z.string().uuid(),
    channelName: z.string(),
    receivedAt: z.string(),
    processed: z.boolean(),
    status: z.string().nullable(),
    connectorName: z.string().nullable(),
  })),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type CrossChannelSearchResult = z.infer<typeof crossChannelSearchResultSchema>;
