import { z } from 'zod/v4';
import { idSchema } from './id.schema.js';

export const CODE_TEMPLATE_CONTEXTS = [
  'GLOBAL_DEPLOY',
  'GLOBAL_UNDEPLOY',
  'GLOBAL_PREPROCESSOR',
  'GLOBAL_POSTPROCESSOR',
  'CHANNEL_DEPLOY',
  'CHANNEL_UNDEPLOY',
  'CHANNEL_PREPROCESSOR',
  'CHANNEL_POSTPROCESSOR',
  'CHANNEL_ATTACHMENT',
  'CHANNEL_BATCH',
  'SOURCE_RECEIVER',
  'SOURCE_FILTER_TRANSFORMER',
  'DESTINATION_FILTER_TRANSFORMER',
  'DESTINATION_DISPATCHER',
  'DESTINATION_RESPONSE_TRANSFORMER',
] as const;

export const codeTemplateContextSchema = z.enum(CODE_TEMPLATE_CONTEXTS);

export const CODE_TEMPLATE_TYPES = ['FUNCTION', 'CODE_BLOCK'] as const;

export const codeTemplateTypeSchema = z.enum(CODE_TEMPLATE_TYPES);

// The editor's authoring mode; the engine transpiles TS to JS regardless.
export const CODE_TEMPLATE_LANGUAGES = ['JAVASCRIPT', 'TYPESCRIPT'] as const;

export const codeTemplateLanguageSchema = z.enum(CODE_TEMPLATE_LANGUAGES);

export type CodeTemplateLanguage = (typeof CODE_TEMPLATE_LANGUAGES)[number];

/** null: every channel. */
const libraryChannelIdsSchema = z.array(idSchema).max(10_000).nullable();

export const createCodeTemplateLibrarySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().default(''),
  channelIds: libraryChannelIdsSchema.optional(),
});

export type CreateCodeTemplateLibraryInput = z.infer<typeof createCodeTemplateLibrarySchema>;

export const updateCodeTemplateLibrarySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  channelIds: libraryChannelIdsSchema.optional(),
  revision: z.number().int().positive(),
});

export type UpdateCodeTemplateLibraryInput = z.infer<typeof updateCodeTemplateLibrarySchema>;

export const createCodeTemplateSchema = z.object({
  libraryId: idSchema,
  name: z.string().min(1).max(255),
  description: z.string().default(''),
  type: codeTemplateTypeSchema,
  language: codeTemplateLanguageSchema.default('JAVASCRIPT'),
  code: z.string().default(''),
  contexts: z.array(codeTemplateContextSchema),
});

export type CreateCodeTemplateInput = z.infer<typeof createCodeTemplateSchema>;

export const updateCodeTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  type: codeTemplateTypeSchema.optional(),
  language: codeTemplateLanguageSchema.optional(),
  code: z.string().optional(),
  contexts: z.array(codeTemplateContextSchema).optional(),
  revision: z.number().int().positive(),
});

export type UpdateCodeTemplateInput = z.infer<typeof updateCodeTemplateSchema>;

export const codeTemplateListQuerySchema = z.object({
  libraryId: idSchema.optional(),
});

export type CodeTemplateListQuery = z.infer<typeof codeTemplateListQuerySchema>;

export const codeTemplateUuidParamSchema = z.object({
  id: idSchema,
});
