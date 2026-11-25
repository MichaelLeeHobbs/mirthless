import { tryCatch, type Result } from 'stderr-lib';
import { eq, isNull, and, count, asc, sql } from 'drizzle-orm';
import { ALL_CHANNELS, EVENT_NAME } from '@galvanigraph/core-models';
import { channelIdIn, type ChannelScope } from '../lib/channel-scope.js';
import {
  DEFAULT_STORED_SCRIPT_LANGUAGE,
  toScriptLanguage,
  type ScriptLanguageCode,
  type CreateChannelInput,
  type UpdateChannelInput,
  type ChannelListQuery,
  type DestinationConnectorType,
  isSourceConnectorType,
  isDestinationConnectorType,
} from '@galvanigraph/core-models';
import { holdsRedacted, REDACTED } from '../lib/secret-redaction.js';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db, type DbReader } from '../lib/db.js';
import { PartitionManagerService } from './partition-manager.service.js';
import { ChannelRevisionService } from './channel-revision.service.js';
import { GrantService } from './grant.service.js';
import logger from '../lib/logger.js';
import {
  channels,
  channelScripts,
  channelConnectors,
  channelMetadataColumns,
  channelTagAssignments,
  channelTags,
  channelFilters,
  filterRules,
  channelTransformers,
  transformerSteps,
  codeTemplateLibraries,
} from '../db/schema/index.js';

export interface ChannelSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly revision: number;
  readonly inboundDataType: string;
  readonly outboundDataType: string;
  readonly sourceConnectorType: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ChannelDeployEntry {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

export interface ChannelScript {
  readonly id: string;
  readonly scriptType: string;
  readonly script: string;
  readonly language: string;
}

export interface ChannelDestination {
  readonly id: string;
  readonly metaDataId: number;
  readonly name: string;
  readonly enabled: boolean;
  readonly connectorType: string;
  readonly properties: Record<string, unknown>;
  readonly queueMode: string;
  readonly retryCount: number;
  readonly retryIntervalMs: number;
  readonly rotateQueue: boolean;
  readonly queueThreadCount: number;
  readonly waitForPrevious: boolean;
  readonly responseTransformer: string | null;
  readonly responseTransformerLanguage: string;
}

export interface ChannelMetadataCol {
  readonly id: string;
  readonly name: string;
  readonly dataType: string;
  readonly mappingExpression: string | null;
}

export interface ChannelTagInfo {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
}

export interface ChannelFilterRuleDetail {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly enabled: boolean;
  readonly name: string | null;
  readonly operator: string;
  readonly type: string;
  readonly script: string | null;
  readonly language: string;
  readonly field: string | null;
  readonly condition: string | null;
  readonly values: readonly string[] | null;
}

export interface ChannelFilterDetail {
  readonly id: string;
  readonly connectorId: string | null;
  readonly rules: readonly ChannelFilterRuleDetail[];
}

export interface ChannelTransformerStepDetail {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly enabled: boolean;
  readonly name: string | null;
  readonly type: string;
  readonly script: string | null;
  readonly language: string;
  readonly sourceField: string | null;
  readonly targetField: string | null;
  readonly defaultValue: string | null;
  readonly mapping: string | null;
}

export interface ChannelTransformerDetail {
  readonly id: string;
  readonly connectorId: string | null;
  readonly inboundDataType: string;
  readonly outboundDataType: string;
  readonly inboundProperties: Record<string, unknown>;
  readonly outboundProperties: Record<string, unknown>;
  readonly inboundTemplate: string | null;
  readonly outboundTemplate: string | null;
  readonly steps: readonly ChannelTransformerStepDetail[];
}

export interface ChannelDetail extends ChannelSummary {
  readonly responseMode: string;
  readonly responseConnectorName: string | null;
  readonly initialState: string;
  readonly messageStorageMode: string;
  readonly encryptData: boolean;
  readonly removeContentOnCompletion: boolean;
  readonly removeAttachmentsOnCompletion: boolean;
  readonly pruningEnabled: boolean;
  readonly pruningMaxAgeDays: number | null;
  readonly pruningArchiveEnabled: boolean;
  readonly scriptTimeoutSeconds: number;
  readonly sourceConnectorProperties: Record<string, unknown>;
  readonly scripts: readonly ChannelScript[];
  readonly destinations: readonly ChannelDestination[];
  readonly metadataColumns: readonly ChannelMetadataCol[];
  readonly tags: readonly ChannelTagInfo[];
  readonly filters: readonly ChannelFilterDetail[];
  readonly transformers: readonly ChannelTransformerDetail[];
}

export interface ChannelListResult {
  readonly data: readonly ChannelSummary[];
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

const DEFAULT_SCRIPT_TYPES = ['DEPLOY', 'UNDEPLOY', 'PREPROCESSOR', 'POSTPROCESSOR'] as const;

async function findChannel(id: string, reader: DbReader = db): Promise<typeof channels.$inferSelect> {
  const [channel] = await reader
    .select()
    .from(channels)
    .where(and(eq(channels.id, id), isNull(channels.deletedAt)));

  if (!channel) {
    throw new ServiceError('NOT_FOUND', `Channel not found: ${id}`);
  }
  return channel;
}

interface ChannelRelations {
  readonly scripts: readonly ChannelScript[];
  readonly destinations: readonly ChannelDestination[];
  readonly metadataColumns: readonly ChannelMetadataCol[];
  readonly tags: readonly ChannelTagInfo[];
  readonly filters: readonly ChannelFilterDetail[];
  readonly transformers: readonly ChannelTransformerDetail[];
}

type AwaitedAll<T extends readonly unknown[]> = { -readonly [P in keyof T]: Awaited<T[P]> };

/**
 * Run Drizzle queries (which start only when awaited): together on the pool,
 * one after another in a transaction, whose single connection runs one query
 * at a time (pg 9 refuses overlapping ones).
 */
async function runQueries<T extends readonly unknown[] | []>(reader: DbReader, queries: T): Promise<AwaitedAll<T>> {
  if (reader === db) return Promise.all(queries);
  const results: unknown[] = [];
  for (const query of queries) results.push(await query);
  return results as AwaitedAll<T>;
}

async function fetchChannelRelations(id: string, reader: DbReader = db): Promise<ChannelRelations> {
  const [scriptRows, destinationRows, metadataRows, tagRows, filterRows, ruleRows, transformerRows, stepRows] = await runQueries(reader, [
    reader
      .select({
        id: channelScripts.id, scriptType: channelScripts.scriptType, script: channelScripts.script, language: channelScripts.language,
      })
      .from(channelScripts)
      .where(eq(channelScripts.channelId, id)),
    reader
      .select({
        id: channelConnectors.id,
        metaDataId: channelConnectors.metaDataId,
        name: channelConnectors.name,
        enabled: channelConnectors.enabled,
        connectorType: channelConnectors.connectorType,
        properties: channelConnectors.properties,
        queueMode: channelConnectors.queueMode,
        retryCount: channelConnectors.retryCount,
        retryIntervalMs: channelConnectors.retryIntervalMs,
        rotateQueue: channelConnectors.rotateQueue,
        queueThreadCount: channelConnectors.queueThreadCount,
        waitForPrevious: channelConnectors.waitForPrevious,
        responseTransformer: channelConnectors.responseTransformer,
        responseTransformerLanguage: channelConnectors.responseTransformerLanguage,
      })
      .from(channelConnectors)
      .where(eq(channelConnectors.channelId, id))
      .orderBy(asc(channelConnectors.metaDataId)),
    reader
      .select({
        id: channelMetadataColumns.id,
        name: channelMetadataColumns.name,
        dataType: channelMetadataColumns.dataType,
        mappingExpression: channelMetadataColumns.mappingExpression,
      })
      .from(channelMetadataColumns)
      .where(eq(channelMetadataColumns.channelId, id)),
    reader
      .select({ id: channelTags.id, name: channelTags.name, color: channelTags.color })
      .from(channelTagAssignments)
      .innerJoin(channelTags, eq(channelTagAssignments.tagId, channelTags.id))
      .where(eq(channelTagAssignments.channelId, id)),
    reader
      .select({ id: channelFilters.id, connectorId: channelFilters.connectorId })
      .from(channelFilters)
      .where(eq(channelFilters.channelId, id)),
    reader
      .select({
        id: filterRules.id,
        filterId: filterRules.filterId,
        sequenceNumber: filterRules.sequenceNumber,
        enabled: filterRules.enabled,
        name: filterRules.name,
        operator: filterRules.operator,
        type: filterRules.type,
        script: filterRules.script,
        language: filterRules.language,
        field: filterRules.field,
        condition: filterRules.condition,
        values: filterRules.values,
      })
      .from(filterRules)
      .innerJoin(channelFilters, eq(filterRules.filterId, channelFilters.id))
      .where(eq(channelFilters.channelId, id)),
    reader
      .select({
        id: channelTransformers.id,
        connectorId: channelTransformers.connectorId,
        inboundDataType: channelTransformers.inboundDataType,
        outboundDataType: channelTransformers.outboundDataType,
        inboundProperties: channelTransformers.inboundProperties,
        outboundProperties: channelTransformers.outboundProperties,
        inboundTemplate: channelTransformers.inboundTemplate,
        outboundTemplate: channelTransformers.outboundTemplate,
      })
      .from(channelTransformers)
      .where(eq(channelTransformers.channelId, id)),
    reader
      .select({
        id: transformerSteps.id,
        transformerId: transformerSteps.transformerId,
        sequenceNumber: transformerSteps.sequenceNumber,
        enabled: transformerSteps.enabled,
        name: transformerSteps.name,
        type: transformerSteps.type,
        script: transformerSteps.script,
        language: transformerSteps.language,
        sourceField: transformerSteps.sourceField,
        targetField: transformerSteps.targetField,
        defaultValue: transformerSteps.defaultValue,
        mapping: transformerSteps.mapping,
      })
      .from(transformerSteps)
      .innerJoin(channelTransformers, eq(transformerSteps.transformerId, channelTransformers.id))
      .where(eq(channelTransformers.channelId, id)),
  ]);

  const rulesByFilterId = new Map<string, ChannelFilterRuleDetail[]>();
  for (const r of ruleRows) {
    const arr = rulesByFilterId.get(r.filterId) ?? [];
    arr.push({
      id: r.id,
      sequenceNumber: r.sequenceNumber,
      enabled: r.enabled,
      name: r.name,
      operator: r.operator,
      type: r.type,
      script: r.script,
      language: r.language,
      field: r.field,
      condition: r.condition,
      values: r.values ?? null,
    });
    rulesByFilterId.set(r.filterId, arr);
  }

  const filters: ChannelFilterDetail[] = filterRows.map((f) => ({
    id: f.id,
    connectorId: f.connectorId,
    rules: (rulesByFilterId.get(f.id) ?? []).sort((a, b) => a.sequenceNumber - b.sequenceNumber),
  }));

  const stepsByTransformerId = new Map<string, ChannelTransformerStepDetail[]>();
  for (const s of stepRows) {
    const arr = stepsByTransformerId.get(s.transformerId) ?? [];
    arr.push({
      id: s.id,
      sequenceNumber: s.sequenceNumber,
      enabled: s.enabled,
      name: s.name,
      type: s.type,
      script: s.script,
      language: s.language,
      sourceField: s.sourceField,
      targetField: s.targetField,
      defaultValue: s.defaultValue,
      mapping: s.mapping,
    });
    stepsByTransformerId.set(s.transformerId, arr);
  }

  const transformers: ChannelTransformerDetail[] = transformerRows.map((t) => ({
    id: t.id,
    connectorId: t.connectorId,
    inboundDataType: t.inboundDataType,
    outboundDataType: t.outboundDataType,
    inboundProperties: t.inboundProperties,
    outboundProperties: t.outboundProperties,
    inboundTemplate: t.inboundTemplate,
    outboundTemplate: t.outboundTemplate,
    steps: (stepsByTransformerId.get(t.id) ?? []).sort((a, b) => a.sequenceNumber - b.sequenceNumber),
  }));

  return {
    scripts: scriptRows,
    destinations: destinationRows,
    metadataColumns: metadataRows,
    tags: tagRows,
    filters,
    transformers,
  };
}

function assembleDetail(
  channel: typeof channels.$inferSelect,
  relations: ChannelRelations
): ChannelDetail {
  return {
    id: channel.id,
    name: channel.name,
    description: channel.description,
    enabled: channel.enabled,
    revision: channel.revision,
    inboundDataType: channel.inboundDataType,
    outboundDataType: channel.outboundDataType,
    sourceConnectorType: channel.sourceConnectorType,
    responseMode: channel.responseMode,
    responseConnectorName: channel.responseConnectorName,
    initialState: channel.initialState,
    messageStorageMode: channel.messageStorageMode,
    encryptData: channel.encryptData,
    removeContentOnCompletion: channel.removeContentOnCompletion,
    removeAttachmentsOnCompletion: channel.removeAttachmentsOnCompletion,
    pruningEnabled: channel.pruningEnabled,
    pruningMaxAgeDays: channel.pruningMaxAgeDays,
    pruningArchiveEnabled: channel.pruningArchiveEnabled,
    scriptTimeoutSeconds: channel.scriptTimeoutSeconds,
    sourceConnectorProperties: channel.sourceConnectorProperties,
    scripts: relations.scripts,
    destinations: relations.destinations,
    metadataColumns: relations.metadataColumns,
    tags: relations.tags,
    filters: relations.filters,
    transformers: relations.transformers,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}

/** A channel read with its credentials masked, then sent back, would lose them. */
function refuseMaskedCredentials(input: Pick<UpdateChannelInput, 'sourceConnectorProperties' | 'destinations'>): void {
  const masked = [
    ...(holdsRedacted(input.sourceConnectorProperties ?? {}) ? ['The source'] : []),
    ...(input.destinations ?? []).filter((d) => holdsRedacted(d.properties)).map((d) => `Destination "${d.name}"`),
  ];
  if (masked[0] === undefined) return;
  throw new ServiceError('INVALID_INPUT', `${masked[0]} holds a masked credential (${REDACTED}). Reload the channel, or enter the credential.`);
}

function buildCloneScripts(source: ChannelDetail): CreateChannelInput['scripts'] {
  const find = (type: string): ChannelScript | undefined => source.scripts.find((s) => s.scriptType === type);
  const language = (type: string): ScriptLanguageCode => toScriptLanguage(find(type)?.language);
  return {
    deploy: find('DEPLOY')?.script ?? null,
    undeploy: find('UNDEPLOY')?.script ?? null,
    preprocessor: find('PREPROCESSOR')?.script ?? null,
    postprocessor: find('POSTPROCESSOR')?.script ?? null,
    languages: {
      deploy: language('DEPLOY'),
      undeploy: language('UNDEPLOY'),
      preprocessor: language('PREPROCESSOR'),
      postprocessor: language('POSTPROCESSOR'),
    },
  };
}

function buildCloneDestinations(source: ChannelDetail): CreateChannelInput['destinations'] {
  return source.destinations.map((d) => ({
    name: d.name,
    enabled: d.enabled,
    connectorType: d.connectorType as DestinationConnectorType,
    properties: d.properties,
    queueMode: d.queueMode as 'NEVER' | 'ON_FAILURE' | 'ALWAYS',
    retryCount: d.retryCount,
    retryIntervalMs: d.retryIntervalMs,
    rotateQueue: d.rotateQueue,
    queueThreadCount: d.queueThreadCount,
    waitForPrevious: d.waitForPrevious,
    responseTransformer: d.responseTransformer,
    responseTransformerLanguage: toScriptLanguage(d.responseTransformerLanguage),
  }));
}

type CloneFilter = NonNullable<CreateChannelInput['filters']>[number];
type CloneTransformer = NonNullable<CreateChannelInput['transformers']>[number];

/**
 * `create` numbers destinations by position (index + 1), so a gap in the
 * source's metaDataIds is renumbered. Throws on an unknown connector rather than
 * silently moving a destination's filter or transformer onto the source.
 */
function cloneMetaDataId(source: ChannelDetail, connectorId: string | null): number | null {
  if (connectorId === null) return null;
  const index = source.destinations.findIndex((d) => d.id === connectorId);
  if (index < 0) {
    throw new ServiceError('INTERNAL', `Channel ${source.id} has a filter or transformer on unknown connector ${connectorId}`);
  }
  return index + 1;
}

function buildCloneFilters(source: ChannelDetail): CloneFilter[] {
  return source.filters.map((f) => ({
    connectorId: null,
    metaDataId: cloneMetaDataId(source, f.connectorId),
    rules: f.rules.map((r) => ({
      enabled: r.enabled,
      ...(r.name !== null ? { name: r.name } : {}),
      operator: r.operator as CloneFilter['rules'][number]['operator'],
      type: r.type as CloneFilter['rules'][number]['type'],
      script: r.script,
      language: toScriptLanguage(r.language),
      field: r.field,
      condition: r.condition,
      values: r.values ? [...r.values] : null,
    })),
  }));
}

function buildCloneTransformers(source: ChannelDetail): CloneTransformer[] {
  return source.transformers.map((t) => ({
    connectorId: null,
    metaDataId: cloneMetaDataId(source, t.connectorId),
    inboundDataType: t.inboundDataType,
    outboundDataType: t.outboundDataType,
    inboundProperties: t.inboundProperties,
    outboundProperties: t.outboundProperties,
    inboundTemplate: t.inboundTemplate,
    outboundTemplate: t.outboundTemplate,
    steps: t.steps.map((s) => ({
      enabled: s.enabled,
      ...(s.name !== null ? { name: s.name } : {}),
      type: s.type as CloneTransformer['steps'][number]['type'],
      script: s.script,
      language: toScriptLanguage(s.language),
      sourceField: s.sourceField,
      targetField: s.targetField,
      defaultValue: s.defaultValue,
      mapping: s.mapping,
    })),
  }));
}

function buildCloneInput(source: ChannelDetail, newName: string): CreateChannelInput {
  return {
    name: newName,
    description: source.description ?? '',
    enabled: false,
    inboundDataType: source.inboundDataType as CreateChannelInput['inboundDataType'],
    outboundDataType: source.outboundDataType as CreateChannelInput['outboundDataType'],
    sourceConnectorType: source.sourceConnectorType as CreateChannelInput['sourceConnectorType'],
    sourceConnectorProperties: source.sourceConnectorProperties,
    responseMode: source.responseMode as CreateChannelInput['responseMode'],
    responseConnectorName: source.responseConnectorName,
    properties: {
      initialState: source.initialState as 'UNDEPLOYED' | 'STARTED' | 'PAUSED' | 'STOPPED',
      messageStorageMode: source.messageStorageMode as 'DEVELOPMENT' | 'PRODUCTION' | 'RAW' | 'METADATA' | 'DISABLED',
      // Keep encryption: a clone of an encrypted channel must not quietly store
      // PHI in plaintext. Deploy refuses it loudly if no key is configured.
      encryptData: source.encryptData,
      removeContentOnCompletion: source.removeContentOnCompletion,
      removeAttachmentsOnCompletion: source.removeAttachmentsOnCompletion,
      pruningEnabled: source.pruningEnabled,
      pruningMaxAgeDays: source.pruningMaxAgeDays,
      pruningArchiveEnabled: source.pruningArchiveEnabled,
      scriptTimeoutSeconds: source.scriptTimeoutSeconds,
    },
    scripts: buildCloneScripts(source),
    destinations: buildCloneDestinations(source),
    metadataColumns: source.metadataColumns.map((c) => ({
      name: c.name,
      dataType: c.dataType as 'STRING' | 'NUMBER' | 'BOOLEAN' | 'TIMESTAMP',
      mappingExpression: c.mappingExpression,
    })),
    filters: buildCloneFilters(source),
    transformers: buildCloneTransformers(source),
  };
}

type ChannelTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function syncFilters(
  tx: ChannelTx,
  channelId: string,
  filters: NonNullable<CreateChannelInput['filters']>,
  destIdByMetaDataId: ReadonlyMap<number, string>,
): Promise<void> {
  await tx.delete(channelFilters).where(eq(channelFilters.channelId, channelId));

  for (const filter of filters) {
    let resolvedConnectorId: string | null = filter.connectorId ?? null;
    if (resolvedConnectorId === null && filter.metaDataId !== undefined && filter.metaDataId !== null) {
      resolvedConnectorId = destIdByMetaDataId.get(filter.metaDataId) ?? null;
    }

    const [inserted] = await tx
      .insert(channelFilters)
      .values({ channelId, connectorId: resolvedConnectorId })
      .returning({ id: channelFilters.id });

    if (inserted && filter.rules.length > 0) {
      const ruleValues = filter.rules.map((rule, idx) => ({
        filterId: inserted.id,
        sequenceNumber: idx,
        enabled: rule.enabled,
        name: rule.name ?? null,
        operator: rule.operator,
        type: rule.type,
        script: rule.script ?? null,
        language: rule.language ?? DEFAULT_STORED_SCRIPT_LANGUAGE,
        field: rule.field ?? null,
        condition: rule.condition ?? null,
        values: rule.values ?? null,
      }));
      await tx.insert(filterRules).values(ruleValues);
    }
  }
}

async function syncTransformers(
  tx: ChannelTx,
  channelId: string,
  transformers: NonNullable<CreateChannelInput['transformers']>,
  destIdByMetaDataId: ReadonlyMap<number, string>,
): Promise<void> {
  await tx.delete(channelTransformers).where(eq(channelTransformers.channelId, channelId));

  for (const transformer of transformers) {
    let resolvedConnectorId: string | null = transformer.connectorId ?? null;
    if (resolvedConnectorId === null && transformer.metaDataId !== undefined && transformer.metaDataId !== null) {
      resolvedConnectorId = destIdByMetaDataId.get(transformer.metaDataId) ?? null;
    }

    const [inserted] = await tx
      .insert(channelTransformers)
      .values({
        channelId,
        connectorId: resolvedConnectorId,
        inboundDataType: transformer.inboundDataType,
        outboundDataType: transformer.outboundDataType,
        inboundProperties: transformer.inboundProperties,
        outboundProperties: transformer.outboundProperties,
        inboundTemplate: transformer.inboundTemplate ?? null,
        outboundTemplate: transformer.outboundTemplate ?? null,
      })
      .returning({ id: channelTransformers.id });

    if (inserted && transformer.steps.length > 0) {
      const stepValues = transformer.steps.map((step, idx) => ({
        transformerId: inserted.id,
        sequenceNumber: idx,
        enabled: step.enabled,
        name: step.name ?? null,
        type: step.type,
        script: step.script ?? null,
        language: step.language ?? DEFAULT_STORED_SCRIPT_LANGUAGE,
        sourceField: step.sourceField ?? null,
        targetField: step.targetField ?? null,
        defaultValue: step.defaultValue ?? null,
        mapping: step.mapping ?? null,
      }));
      await tx.insert(transformerSteps).values(stepValues);
    }
  }
}

/**
 * Add a clone to every code template library whose channel list names the
 * channel it was cloned from (D-249), so the clone's scripts get the same
 * template functions. A library with a null list already reaches every channel
 * and does not match `@>`, so it is left alone. The revision goes up so an
 * editor holding the old list gets a conflict instead of dropping the clone.
 */
async function addCloneToLibraries(tx: ChannelTx, sourceId: string, cloneId: string): Promise<void> {
  await tx
    .update(codeTemplateLibraries)
    .set({
      channelIds: sql`${codeTemplateLibraries.channelIds} || ${JSON.stringify([cloneId])}::jsonb`,
      revision: sql`${codeTemplateLibraries.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(sql`${codeTemplateLibraries.channelIds} @> ${JSON.stringify([sourceId])}::jsonb`);
}

export class ChannelService {
  /** `scope` per D-310. */
  static async list(query: ChannelListQuery, scope: ChannelScope = ALL_CHANNELS): Promise<Result<ChannelListResult>> {
    return tryCatch(async () => {
      const offset = (query.page - 1) * query.pageSize;
      const visible = and(isNull(channels.deletedAt), channelIdIn(channels.id, scope));

      const [rows, [countRow]] = await Promise.all([
        db
          .select({
            id: channels.id,
            name: channels.name,
            description: channels.description,
            enabled: channels.enabled,
            revision: channels.revision,
            inboundDataType: channels.inboundDataType,
            outboundDataType: channels.outboundDataType,
            sourceConnectorType: channels.sourceConnectorType,
            createdAt: channels.createdAt,
            updatedAt: channels.updatedAt,
          })
          .from(channels)
          .where(visible)
          .orderBy(channels.name)
          .limit(query.pageSize)
          .offset(offset),
        db
          .select({ total: count() })
          .from(channels)
          .where(visible),
      ]);

      const total = countRow?.total ?? 0;

      return {
        data: rows,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
        },
      };
    });
  }

  /**
   * The startup auto-deploy reads this rather than paging `list`, whose name
   * order is not unique and whose offsets shift while the API serves, so a page
   * could repeat one channel and skip another.
   */
  static async listLiveForDeploy(): Promise<Result<readonly ChannelDeployEntry[]>> {
    return tryCatch(async () => db
      .select({ id: channels.id, name: channels.name, enabled: channels.enabled })
      .from(channels)
      .where(isNull(channels.deletedAt))
      .orderBy(asc(channels.id)));
  }

  /** A deploy passes its transaction, so the parts are read from one snapshot. */
  static async getById(id: string, reader: DbReader = db): Promise<Result<ChannelDetail>> {
    return tryCatch(async () => {
      const channel = await findChannel(id, reader);
      const relations = await fetchChannelRelations(id, reader);
      return assembleDetail(channel, relations);
    });
  }

  /** `cloneOf`: the channel this one copies; the new channel joins its code template libraries. */
  static async create(input: CreateChannelInput, context?: AuditContext, cloneOf?: string): Promise<Result<ChannelDetail>> {
    return tryCatch(async () => {
      refuseMaskedCredentials(input);
      const [existing] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.name, input.name), isNull(channels.deletedAt)));

      if (existing) {
        throw new ServiceError('ALREADY_EXISTS', `Channel with name "${input.name}" already exists`);
      }

      const now = new Date();
      const channelValues: typeof channels.$inferInsert = {
        name: input.name,
        description: input.description,
        enabled: input.enabled,
        inboundDataType: input.inboundDataType,
        outboundDataType: input.outboundDataType,
        sourceConnectorType: input.sourceConnectorType,
        sourceConnectorProperties: input.sourceConnectorProperties,
        responseMode: input.responseMode,
        createdAt: now,
        updatedAt: now,
      };

      if (input.responseConnectorName !== undefined && input.responseConnectorName !== null) {
        channelValues.responseConnectorName = input.responseConnectorName;
      }
      if (input.properties) {
        channelValues.initialState = input.properties.initialState;
        channelValues.messageStorageMode = input.properties.messageStorageMode;
        channelValues.encryptData = input.properties.encryptData;
        channelValues.removeContentOnCompletion = input.properties.removeContentOnCompletion;
        channelValues.removeAttachmentsOnCompletion = input.properties.removeAttachmentsOnCompletion;
        channelValues.pruningEnabled = input.properties.pruningEnabled;
        channelValues.pruningMaxAgeDays = input.properties.pruningMaxAgeDays;
        channelValues.pruningArchiveEnabled = input.properties.pruningArchiveEnabled;
        if (input.properties.scriptTimeoutSeconds !== undefined) {
          channelValues.scriptTimeoutSeconds = input.properties.scriptTimeoutSeconds;
        }
      }

      const [created] = await db.transaction(async (tx) => {
        const inserted = await tx.insert(channels).values(channelValues).returning();

        const channelId = inserted[0]!.id;

        const scriptValues = DEFAULT_SCRIPT_TYPES.map((scriptType) => {
          const key = scriptType.toLowerCase() as 'deploy' | 'undeploy' | 'preprocessor' | 'postprocessor';
          return {
            channelId,
            scriptType,
            script: input.scripts?.[key] ?? '',
            language: input.scripts?.languages[key] ?? DEFAULT_STORED_SCRIPT_LANGUAGE,
          };
        });

        await tx.insert(channelScripts).values(scriptValues);

        const destIdByMetaDataId = new Map<number, string>();
        if (input.destinations && input.destinations.length > 0) {
          const destValues = input.destinations.map((dest, index) => ({
            channelId,
            metaDataId: index + 1,
            name: dest.name,
            enabled: dest.enabled,
            connectorType: dest.connectorType,
            properties: dest.properties,
            queueMode: dest.queueMode,
            retryCount: dest.retryCount,
            retryIntervalMs: dest.retryIntervalMs,
            rotateQueue: dest.rotateQueue,
            queueThreadCount: dest.queueThreadCount,
            waitForPrevious: dest.waitForPrevious,
            responseTransformer: dest.responseTransformer ?? null,
            responseTransformerLanguage: dest.responseTransformerLanguage ?? DEFAULT_STORED_SCRIPT_LANGUAGE,
          }));
          const insertedDests = await tx.insert(channelConnectors).values(destValues).returning({
            id: channelConnectors.id,
            metaDataId: channelConnectors.metaDataId,
          });
          for (const d of insertedDests) {
            destIdByMetaDataId.set(d.metaDataId, d.id);
          }
        }

        if (input.metadataColumns && input.metadataColumns.length > 0) {
          const metaValues = input.metadataColumns.map((col) => ({
            channelId,
            name: col.name,
            dataType: col.dataType,
            mappingExpression: col.mappingExpression,
          }));
          await tx.insert(channelMetadataColumns).values(metaValues);
        }

        if (input.filters && input.filters.length > 0) {
          await syncFilters(tx, channelId, input.filters, destIdByMetaDataId);
        }
        if (input.transformers && input.transformers.length > 0) {
          await syncTransformers(tx, channelId, input.transformers, destIdByMetaDataId);
        }
        if (cloneOf !== undefined) await addCloneToLibraries(tx, cloneOf, channelId);
        // Into a group inside the creator's channels:write scope (D-310), or the
        // channel would be out of a scoped creator's own reach.
        await GrantService.placeNewChannel(tx, channelId, input.groupId, { userId: context?.userId ?? null, ipAddress: context?.ipAddress ?? null });

        // Partitions in the same transaction: a channel without them would put
        // its messages in the default partitions, so a failure rolls it back
        // (#260). Last, because it locks the six message tables until commit.
        const partitions = await PartitionManagerService.createPartitions(channelId, tx);
        if (!partitions.ok) {
          throw new ServiceError('INTERNAL', `Channel "${input.name}" was not created: its message partitions could not be created: ${partitions.error.message}`);
        }

        return inserted;
      });

      const channel = created!;

      const relations = await fetchChannelRelations(channel.id);
      const detail = assembleDetail(channel, relations);

      emitEvent({
        level: 'INFO', name: 'CHANNEL_CREATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: channel.id,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { channelName: input.name },
      });

      return detail;
    });
  }

  static async update(id: string, input: UpdateChannelInput, context?: AuditContext): Promise<Result<ChannelDetail>> {
    return tryCatch(async () => {
      refuseMaskedCredentials(input);
      const existing = await findChannel(id);

      if (existing.revision !== input.revision) {
        throw new ServiceError('CONFLICT', 'Channel has been modified by another user', {
          currentRevision: existing.revision,
          providedRevision: input.revision,
        });
      }

      const now = new Date();
      const updateValues: Record<string, unknown> = {
        revision: existing.revision + 1,
        updatedAt: now,
      };

      if (input.name !== undefined) updateValues['name'] = input.name;
      if (input.description !== undefined) updateValues['description'] = input.description;
      if (input.enabled !== undefined) updateValues['enabled'] = input.enabled;
      if (input.inboundDataType !== undefined) updateValues['inboundDataType'] = input.inboundDataType;
      if (input.outboundDataType !== undefined) updateValues['outboundDataType'] = input.outboundDataType;
      if (input.sourceConnectorType !== undefined) updateValues['sourceConnectorType'] = input.sourceConnectorType;
      if (input.sourceConnectorProperties !== undefined) updateValues['sourceConnectorProperties'] = input.sourceConnectorProperties;
      if (input.responseMode !== undefined) updateValues['responseMode'] = input.responseMode;
      if (input.responseConnectorName !== undefined) updateValues['responseConnectorName'] = input.responseConnectorName;

      if (input.properties) {
        if (input.properties.initialState !== undefined) updateValues['initialState'] = input.properties.initialState;
        if (input.properties.messageStorageMode !== undefined) updateValues['messageStorageMode'] = input.properties.messageStorageMode;
        if (input.properties.encryptData !== undefined) updateValues['encryptData'] = input.properties.encryptData;
        if (input.properties.removeContentOnCompletion !== undefined) updateValues['removeContentOnCompletion'] = input.properties.removeContentOnCompletion;
        if (input.properties.removeAttachmentsOnCompletion !== undefined) updateValues['removeAttachmentsOnCompletion'] = input.properties.removeAttachmentsOnCompletion;
        if (input.properties.pruningEnabled !== undefined) updateValues['pruningEnabled'] = input.properties.pruningEnabled;
        if (input.properties.pruningMaxAgeDays !== undefined) updateValues['pruningMaxAgeDays'] = input.properties.pruningMaxAgeDays;
        if (input.properties.pruningArchiveEnabled !== undefined) updateValues['pruningArchiveEnabled'] = input.properties.pruningArchiveEnabled;
        if (input.properties.scriptTimeoutSeconds !== undefined) updateValues['scriptTimeoutSeconds'] = input.properties.scriptTimeoutSeconds;
      }

      if (input.name !== undefined && input.name !== existing.name) {
        const [duplicate] = await db
          .select({ id: channels.id })
          .from(channels)
          .where(and(eq(channels.name, input.name), isNull(channels.deletedAt)));

        if (duplicate) {
          throw new ServiceError('ALREADY_EXISTS', `Channel with name "${input.name}" already exists`);
        }
      }

      // One transaction, so a mid-way failure cannot leave a channel with its
      // destinations/filters/transformers deleted-but-not-reinserted. The UPDATE
      // carries the expected revision in its WHERE: 0 rows means a concurrent
      // writer won the race (409).
      const destIdByMetaDataId = new Map<number, string>();

      await db.transaction(async (tx) => {
        const updatedRows = await tx
          .update(channels)
          .set(updateValues)
          .where(and(eq(channels.id, id), eq(channels.revision, input.revision)))
          .returning({ id: channels.id });

        if (updatedRows.length === 0) {
          throw new ServiceError('CONFLICT', 'Channel has been modified by another user', {
            providedRevision: input.revision,
          });
        }

        // A language the request leaves out keeps the stored one (D-294):
        // defaulting it would turn TypeScript into JavaScript and switch off the
        // script's deploy type check.
        if (input.scripts) {
          const { languages, ...scriptsByKey } = input.scripts;
          for (const [key, value] of Object.entries(scriptsByKey)) {
            if (value !== undefined) {
              const scriptType = key.toUpperCase();
              const language = languages[key as keyof typeof languages];
              await tx
                .update(channelScripts)
                .set({ script: value ?? '', ...(language === undefined ? {} : { language }) })
                .where(and(eq(channelScripts.channelId, id), eq(channelScripts.scriptType, scriptType)));
            }
          }
        }

        if (input.destinations) {
          await tx.delete(channelConnectors).where(eq(channelConnectors.channelId, id));

          if (input.destinations.length > 0) {
            const destValues = input.destinations.map((dest, index) => ({
              channelId: id,
              metaDataId: index + 1,
              name: dest.name,
              enabled: dest.enabled,
              connectorType: dest.connectorType,
              properties: dest.properties,
              queueMode: dest.queueMode,
              retryCount: dest.retryCount,
              retryIntervalMs: dest.retryIntervalMs,
              rotateQueue: dest.rotateQueue,
              queueThreadCount: dest.queueThreadCount,
              waitForPrevious: dest.waitForPrevious,
              responseTransformer: dest.responseTransformer ?? null,
              responseTransformerLanguage: dest.responseTransformerLanguage ?? DEFAULT_STORED_SCRIPT_LANGUAGE,
            }));
            const insertedDests = await tx.insert(channelConnectors).values(destValues).returning({
              id: channelConnectors.id,
              metaDataId: channelConnectors.metaDataId,
            });
            for (const d of insertedDests) {
              destIdByMetaDataId.set(d.metaDataId, d.id);
            }
          }
        }

        if (input.metadataColumns) {
          await tx.delete(channelMetadataColumns).where(eq(channelMetadataColumns.channelId, id));

          if (input.metadataColumns.length > 0) {
            const metaValues = input.metadataColumns.map((col) => ({
              channelId: id,
              name: col.name,
              dataType: col.dataType,
              mappingExpression: col.mappingExpression,
            }));
            await tx.insert(channelMetadataColumns).values(metaValues);
          }
        }

        if (input.filters) await syncFilters(tx, id, input.filters, destIdByMetaDataId);
        if (input.transformers) await syncTransformers(tx, id, input.transformers, destIdByMetaDataId);
      });

      const channel = await findChannel(id);
      const relations = await fetchChannelRelations(id);
      const detail = assembleDetail(channel, relations);

      emitEvent({
        level: 'INFO', name: 'CHANNEL_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: id,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { channelName: channel.name },
      });

      // Fire-and-forget: don't block the update response.
      void ChannelRevisionService.saveRevision(
        id,
        channel.revision,
        detail as unknown as Record<string, unknown>,
        context?.userId,
      ).then((result) => {
        if (!result.ok) {
          logger.error({ errMsg: result.error.message, stack: result.error.stack, channelId: id }, 'Failed to save channel revision');
        }
      });

      return detail;
    });
  }

  /**
   * A soft delete must not drop the channel's message partitions: that would
   * irreversibly destroy the message trail it promises to keep, a HIPAA
   * retention hazard. Only an explicit purge of an undeployed channel removes them.
   */
  static async delete(id: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const channel = await findChannel(id);
      await db.update(channels).set({ deletedAt: new Date() }).where(eq(channels.id, id));

      emitEvent({
        level: 'INFO', name: 'CHANNEL_DELETED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: id,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { channelName: channel.name },
      });
    });
  }

  static async clone(id: string, newName: string, context?: AuditContext, groupId?: string): Promise<Result<ChannelDetail>> {
    return tryCatch(async () => {
      const sourceResult = await ChannelService.getById(id);
      if (!sourceResult.ok) throw sourceResult.error;
      const source = sourceResult.value;
      if (!isSourceConnectorType(source.sourceConnectorType) || source.destinations.some((d) => !isDestinationConnectorType(d.connectorType))) {
        throw new ServiceError('INVALID_INPUT', `Channel "${source.name}" has a connector in the wrong direction; change its type before cloning it`);
      }

      const input = { ...buildCloneInput(source, newName), ...(groupId === undefined ? {} : { groupId }) };
      const createResult = await ChannelService.create(input, context, id);
      if (!createResult.ok) throw createResult.error;

      emitEvent({
        level: 'INFO', name: 'CHANNEL_CREATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: createResult.value.id,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { channelName: newName, clonedFrom: id },
      });

      return createResult.value;
    });
  }

  /**
   * The route needs `channels:deploy`: the flag decides what a restart brings
   * back (#225). The revision goes up so an editor opened before gets a conflict.
   */
  static async setEnabled(id: string, enabled: boolean, context?: AuditContext): Promise<Result<ChannelDetail>> {
    return tryCatch(async () => {
      await findChannel(id);

      await db
        .update(channels)
        .set({ enabled, revision: sql`${channels.revision} + 1`, updatedAt: new Date() })
        .where(eq(channels.id, id));

      const channel = await findChannel(id);
      const relations = await fetchChannelRelations(id);
      emitEvent({
        level: 'INFO', name: enabled ? EVENT_NAME.CHANNEL_ENABLED : EVENT_NAME.CHANNEL_DISABLED, outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: id,
        serverId: null, ipAddress: context?.ipAddress ?? null, attributes: { channelName: channel.name },
      });
      return assembleDetail(channel, relations);
    });
  }
}
