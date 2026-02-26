// ===========================================
// Channel Zod Schemas
// ===========================================

import { z } from 'zod/v4';

export const channelPropertiesSchema = z.object({
  initialState: z.enum(['UNDEPLOYED', 'STARTED', 'PAUSED', 'STOPPED']).default('STOPPED'),
  messageStorageMode: z
    .enum(['DEVELOPMENT', 'PRODUCTION', 'RAW', 'METADATA', 'DISABLED'])
    .default('DEVELOPMENT'),
  encryptData: z.boolean().default(false),
  removeContentOnCompletion: z.boolean().default(false),
  removeAttachmentsOnCompletion: z.boolean().default(false),
});

export const channelScriptsSchema = z.object({
  deploy: z.string().nullable().default(null),
  undeploy: z.string().nullable().default(null),
  preprocessor: z.string().nullable().default(null),
  postprocessor: z.string().nullable().default(null),
});

export const createChannelSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().default(''),
  enabled: z.boolean().default(false),
  inboundDataType: z.enum(['RAW', 'HL7V2', 'HL7V3', 'XML', 'JSON', 'DICOM', 'DELIMITED', 'FHIR']),
  outboundDataType: z.enum([
    'RAW',
    'HL7V2',
    'HL7V3',
    'XML',
    'JSON',
    'DICOM',
    'DELIMITED',
    'FHIR',
  ]),
  sourceConnectorType: z.enum([
    'TCP_MLLP',
    'HTTP',
    'FILE',
    'DATABASE',
    'JAVASCRIPT',
    'CHANNEL',
    'DICOM',
    'FHIR',
  ]),
  sourceConnectorProperties: z.record(z.string(), z.unknown()),
  responseMode: z
    .enum([
      'NONE',
      'AUTO_BEFORE',
      'AUTO_AFTER_TRANSFORMER',
      'AUTO_AFTER_DESTINATIONS',
      'POSTPROCESSOR',
      'DESTINATION',
    ])
    .default('AUTO_AFTER_DESTINATIONS'),
  responseConnectorName: z.string().nullable().optional(),
  properties: channelPropertiesSchema.optional(),
  scripts: channelScriptsSchema.optional(),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = createChannelSchema.partial().extend({
  revision: z.number().int().positive(),
});

export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

export const channelListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

export type ChannelListQuery = z.infer<typeof channelListQuerySchema>;

export const patchChannelEnabledSchema = z.object({
  enabled: z.boolean(),
});

export type PatchChannelEnabledInput = z.infer<typeof patchChannelEnabledSchema>;
