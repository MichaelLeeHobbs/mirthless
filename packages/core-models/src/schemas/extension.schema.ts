// ===========================================
// Extension Schemas
// ===========================================

import { z } from 'zod';

export const EXTENSION_TYPE = {
  CONNECTOR: 'CONNECTOR',
  DATA_TYPE: 'DATA_TYPE',
} as const;
export type ExtensionType = (typeof EXTENSION_TYPE)[keyof typeof EXTENSION_TYPE];

export const extensionResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  type: z.enum([EXTENSION_TYPE.CONNECTOR, EXTENSION_TYPE.DATA_TYPE]),
  description: z.string(),
  enabled: z.boolean(),
  capabilities: z.array(z.string()),
});

export type ExtensionResponse = z.infer<typeof extensionResponseSchema>;

export const setExtensionEnabledSchema = z.object({
  enabled: z.boolean(),
});

export type SetExtensionEnabledInput = z.infer<typeof setExtensionEnabledSchema>;
