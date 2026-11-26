import { z } from 'zod/v4';
import { CONNECTOR_TYPES, DESTINATION_CONNECTOR_TYPES, SOURCE_CONNECTOR_TYPES } from '../constants.js';
import { connectorRefFields, destinationRefSchema, filterInputSchema, filterRuleInputSchema } from './filter.schema.js';
import { transformerInputSchema, transformerStepInputSchema } from './transformer.schema.js';
import { scriptLanguageSchema } from './script-language.schema.js';
import { idSchema } from './id.schema.js';
import { withoutDefaults } from './without-defaults.js';

export const connectorTypeSchema = z.enum(CONNECTOR_TYPES);

export const sourceConnectorTypeSchema = z.enum(SOURCE_CONNECTOR_TYPES);

export const destinationConnectorTypeSchema = z.enum(DESTINATION_CONNECTOR_TYPES);

export const channelPropertiesSchema = z.object({
  initialState: z.enum(['UNDEPLOYED', 'STARTED', 'PAUSED', 'STOPPED']).default('STOPPED'),
  messageStorageMode: z
    .enum(['DEVELOPMENT', 'PRODUCTION', 'RAW', 'METADATA', 'DISABLED'])
    .default('DEVELOPMENT'),
  encryptData: z.boolean().default(false),
  removeContentOnCompletion: z.boolean().default(false),
  removeAttachmentsOnCompletion: z.boolean().default(false),
  pruningEnabled: z.boolean().default(false),
  pruningMaxAgeDays: z.number().int().positive().nullable().default(null),
  pruningArchiveEnabled: z.boolean().default(false),
  scriptTimeoutSeconds: z.number().int().min(1).max(300).default(30),
});

export const destinationInputSchema = z.object({
  /**
   * On update, the id of the destination this is, or other text that holds no UUID for a new one, for
   * its filter and transformer to name it by. On create every destination is new.
   */
  id: destinationRefSchema.optional(),
  name: z.string().min(1).max(255),
  enabled: z.boolean().default(true),
  connectorType: destinationConnectorTypeSchema,
  properties: z.record(z.string(), z.unknown()),
  queueMode: z.enum(['NEVER', 'ON_FAILURE', 'ALWAYS']).default('NEVER'),
  retryCount: z.number().int().nonnegative().default(0),
  retryIntervalMs: z.number().int().nonnegative().default(10000),
  rotateQueue: z.boolean().default(false),
  queueThreadCount: z.number().int().positive().default(1),
  waitForPrevious: z.boolean().default(false),
  responseTransformer: z.string().nullish(),
  /** Create stores JavaScript when it is left out; update requires it with a script (D-294). */
  responseTransformerLanguage: scriptLanguageSchema.optional(),
});

export type DestinationInput = z.infer<typeof destinationInputSchema>;

export const metadataColumnInputSchema = z.object({
  name: z.string().min(1).max(255),
  dataType: z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'TIMESTAMP']),
  mappingExpression: z.string().nullable().default(null),
});

export type MetadataColumnInput = z.infer<typeof metadataColumnInputSchema>;

/** The position of the first column that has the name of one before it, or -1. A channel's columns are one per name, as the database holds them. */
export function repeatedColumnIndex(columns: ReadonlyArray<{ readonly name: string }>): number {
  const names = columns.map((c) => c.name);
  return names.findIndex((name, i) => names.indexOf(name) !== i);
}

function uniqueColumnNames(columns: ReadonlyArray<{ readonly name: string }>, ctx: z.RefinementCtx): void {
  const i = repeatedColumnIndex(columns);
  if (i < 0) return;
  ctx.addIssue({ code: 'custom', path: [i, 'name'], message: `Two metadata columns are named "${columns[i]!.name}"; give each its own name` });
}

/** One left out is JavaScript on create and keeps its stored language on update (D-294). */
export const channelScriptLanguagesSchema = z.object({
  deploy: scriptLanguageSchema.optional(),
  undeploy: scriptLanguageSchema.optional(),
  preprocessor: scriptLanguageSchema.optional(),
  postprocessor: scriptLanguageSchema.optional(),
});

export type ChannelScriptLanguages = z.infer<typeof channelScriptLanguagesSchema>;

export const channelScriptsSchema = z.object({
  deploy: z.string().nullable().default(null),
  undeploy: z.string().nullable().default(null),
  preprocessor: z.string().nullable().default(null),
  postprocessor: z.string().nullable().default(null),
  languages: channelScriptLanguagesSchema.prefault({}),
});

export const createChannelSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().default(''),
  enabled: z.boolean().default(false),
  inboundDataType: z.enum(['RAW', 'HL7V2', 'HL7V3', 'XML', 'JSON', 'DICOM', 'DELIMITED', 'FHIR', 'X12']),
  outboundDataType: z.enum(['RAW', 'HL7V2', 'HL7V3', 'XML', 'JSON', 'DICOM', 'DELIMITED', 'FHIR', 'X12']),
  sourceConnectorType: sourceConnectorTypeSchema,
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
  destinations: z.array(destinationInputSchema).optional(),
  metadataColumns: z.array(metadataColumnInputSchema).superRefine(uniqueColumnNames).optional(),
  filters: z.array(filterInputSchema).optional(),
  transformers: z.array(transformerInputSchema).optional(),
  /** The group the new channel joins; see GrantService.placeNewChannel (D-310). */
  groupId: idSchema.optional(),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;

interface LanguagedScript {
  readonly script: string | null | undefined;
  readonly language: string | undefined;
  readonly path: ReadonlyArray<string | number>;
}

function updateScripts(input: z.infer<typeof updateChannelBaseSchema>): ReadonlyArray<LanguagedScript> {
  const found: LanguagedScript[] = [];
  input.filters?.forEach((f, i) => f.rules.forEach((r, j) => {
    found.push({ script: r.script, language: r.language, path: ['filters', i, 'rules', j, 'language'] });
  }));
  input.transformers?.forEach((t, i) => t.steps.forEach((s, j) => {
    found.push({ script: s.script, language: s.language, path: ['transformers', i, 'steps', j, 'language'] });
  }));
  input.destinations?.forEach((d, i) => {
    found.push({ script: d.responseTransformer, language: d.responseTransformerLanguage, path: ['destinations', i, 'responseTransformerLanguage'] });
  });
  return found;
}

/** Which destination each one is cannot be guessed: what waits on its queue goes by it (#395). */
const updateDestinationInputSchema = withoutDefaults(destinationInputSchema)
  .partial({ enabled: true, queueMode: true, retryCount: true, retryIntervalMs: true, rotateQueue: true, queueThreadCount: true, waitForPrevious: true })
  .extend({ id: destinationRefSchema });

export type UpdateDestinationInput = z.infer<typeof updateDestinationInputSchema>;

// Filters, transformers and metadata columns are replaced, and nothing says which stored rule or step one
// is, so what the request leaves out of them cannot be kept. They are given whole (D-360).
const updateFilterInputSchema = withoutDefaults(filterInputSchema).extend({
  metaDataId: connectorRefFields.metaDataId,
  rules: z.array(withoutDefaults(filterRuleInputSchema)),
});

const updateTransformerInputSchema = withoutDefaults(transformerInputSchema).extend({
  metaDataId: connectorRefFields.metaDataId,
  steps: z.array(withoutDefaults(transformerStepInputSchema)),
});

// Groups change through PUT /channels/:id/groups, which judges the grant.
const updateChannelBaseSchema = withoutDefaults(createChannelSchema.omit({ groupId: true })).partial().extend({
  properties: withoutDefaults(channelPropertiesSchema).partial().optional(),
  scripts: withoutDefaults(channelScriptsSchema).partial().optional(),
  destinations: z.array(updateDestinationInputSchema).optional(),
  metadataColumns: z.array(withoutDefaults(metadataColumnInputSchema)).superRefine(uniqueColumnNames).optional(),
  filters: z.array(updateFilterInputSchema).optional(),
  transformers: z.array(updateTransformerInputSchema).optional(),
  revision: z.number().int().positive(),
});

/**
 * Update replaces rules and steps by position, so it cannot keep what the request leaves out of one;
 * a default language would turn TypeScript into JavaScript and switch off its deploy type check (D-294, D-360).
 */
export const updateChannelSchema = updateChannelBaseSchema.superRefine((input, ctx) => {
  for (const s of updateScripts(input)) {
    if (s.script !== null && s.script !== undefined && s.language === undefined) {
      ctx.addIssue({ code: 'custom', path: [...s.path], message: 'Give the script\'s language (JAVASCRIPT or TYPESCRIPT) when updating a channel' });
    }
  }
  for (const key of ['filters', 'transformers'] as const) {
    input[key]?.forEach((ref, i) => {
      if (ref.metaDataId === null) return;
      ctx.addIssue({ code: 'custom', path: [key, i, 'metaDataId'], message: 'Name the destination by its id, in connectorId, when updating a channel' });
    });
  }
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
