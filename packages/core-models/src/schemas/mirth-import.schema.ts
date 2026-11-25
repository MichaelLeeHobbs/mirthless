import { z } from 'zod/v4';
import { idSchema } from './id.schema.js';

export const mirthImportSchema = z.object({
  xml: z.string().min(1),
  collisionMode: z.enum(['SKIP', 'OVERWRITE', 'RENAME']),
  dryRun: z.boolean().default(false),
  /** The group new channels join; see GrantService.placeNewChannel (D-310). */
  groupId: idSchema.optional(),
});

export type MirthImportInput = z.infer<typeof mirthImportSchema>;
