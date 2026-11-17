// ===========================================
// Mirth Connect XML Import Schema
// ===========================================
// Zod schema for Mirth Connect XML import requests.

import { z } from 'zod/v4';

export const mirthImportSchema = z.object({
  xml: z.string().min(1),
  collisionMode: z.enum(['SKIP', 'OVERWRITE', 'RENAME']),
  dryRun: z.boolean().default(false),
  /** The group new channels join; see GrantService.placeNewChannel (D-310). */
  groupId: z.string().uuid().optional(),
});

export type MirthImportInput = z.infer<typeof mirthImportSchema>;
