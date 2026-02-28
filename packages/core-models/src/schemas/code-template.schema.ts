// ===========================================
// Code Template Zod Schemas
// ===========================================

import { z } from 'zod/v4';

// ----- Context Values -----

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

// ----- Library Schemas -----

export const createCodeTemplateLibrarySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().default(''),
});

export type CreateCodeTemplateLibraryInput = z.infer<typeof createCodeTemplateLibrarySchema>;

export const updateCodeTemplateLibrarySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  revision: z.number().int().positive(),
});

export type UpdateCodeTemplateLibraryInput = z.infer<typeof updateCodeTemplateLibrarySchema>;

// ----- Template Schemas -----

export const createCodeTemplateSchema = z.object({
  libraryId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().default(''),
  type: codeTemplateTypeSchema,
  code: z.string().default(''),
  contexts: z.array(codeTemplateContextSchema),
});

export type CreateCodeTemplateInput = z.infer<typeof createCodeTemplateSchema>;

export const updateCodeTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  type: codeTemplateTypeSchema.optional(),
  code: z.string().optional(),
  contexts: z.array(codeTemplateContextSchema).optional(),
  revision: z.number().int().positive(),
});

export type UpdateCodeTemplateInput = z.infer<typeof updateCodeTemplateSchema>;

// ----- Query Params -----

export const codeTemplateListQuerySchema = z.object({
  libraryId: z.string().uuid().optional(),
});

export type CodeTemplateListQuery = z.infer<typeof codeTemplateListQuerySchema>;

export const codeTemplateUuidParamSchema = z.object({
  id: z.string().uuid(),
});
