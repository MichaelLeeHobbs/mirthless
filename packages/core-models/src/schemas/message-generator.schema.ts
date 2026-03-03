// ===========================================
// Message Generator Schemas
// ===========================================

import { z } from 'zod';

export const generateMessagesInputSchema = z.object({
  messageType: z.enum(['ADT_A01', 'ORM_O01', 'ORU_R01', 'SIU_S12']),
  count: z.number().int().min(1).max(100).optional().default(1),
  seed: z.number().int().optional(),
});

export type GenerateMessagesInput = z.infer<typeof generateMessagesInputSchema>;
