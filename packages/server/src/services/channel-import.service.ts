import { tryCatch, type Result } from 'stderr-lib';
import { randomUUID } from 'node:crypto';
import { DrizzleQueryError, eq, isNull, and, sql } from 'drizzle-orm';
import {
  PERMISSIONS,
  can,
  type ChannelGroupId,
  isSourceConnectorType,
  isDestinationConnectorType,
  toScriptLanguage,
  type ChannelExportEntry,
  type CollisionMode,
  type ImportResult,
} from '@galvanigraph/core-models';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { PartitionManagerService } from './partition-manager.service.js';
import { GrantService } from './grant.service.js';
import { assertCertificatesInScope } from './connector-tls-resolver.js';
import { queryUserStanding } from '../lib/principal.js';
import { stripRedactedProperties } from '../lib/secret-redaction.js';
import { overwriteProperties, sameDestination } from '../lib/stored-credentials.js';
import {
  channels,
  channelScripts,
  channelConnectors,
  channelMetadataColumns,
  channelFilters,
  filterRules,
  channelTransformers,
  transformerSteps,
  channelGroupMembers,
} from '../db/schema/index.js';

/**
 * Where an import puts channels (D-310): new channels join `groupId` or the
 * importer's default group (GrantService.placeNewChannel), and an overwrite
 * needs channels:write on the channel it replaces. A backup restore brings its
 * own memberships and runs under system:restore, which covers every channel,
 * so it does neither.
 */
export type ImportPlacement = { readonly groupId?: string } | 'restore';

export class ChannelImportService {
  static async importChannels(
    entries: readonly ChannelExportEntry[],
    collisionMode: CollisionMode,
    context?: AuditContext,
    placement: ImportPlacement = {},
  ): Promise<Result<ImportResult>> {
    return tryCatch(async () => {
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: string[] = [];
      // A group the importer cannot use fails the request, not each channel in it.
      if (placement !== 'restore') {
        await GrantService.newChannelGroup(db, placement.groupId, { userId: context?.userId ?? null });
        // Every certificate private key the file would put to use must already be used in the importer's channels.
        const standing = context?.userId ? await queryUserStanding(db, context.userId) : null;
        await assertCertificatesInScope(standing?.enabled === true ? standing.grants : undefined, PERMISSIONS.CHANNELS_WRITE,
          entries.flatMap((e) => [e.sourceConnectorProperties, ...e.destinations.map((d) => d.properties)]));
      }

      for (const entry of entries) {
        const result = await importSingleChannel(entry, collisionMode, { context, placement });
        if (result === 'created') created++;
        else if (result === 'updated') updated++;
        else if (result === 'skipped') skipped++;
        else errors.push(result);
      }

      emitEvent({
        level: 'INFO', name: 'CHANNEL_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'import', created, updated, skipped, errorCount: errors.length },
      });

      return { created, updated, skipped, errors };
    });
  }
}

type ImportOutcome = 'created' | 'updated' | 'skipped' | string;

/**
 * Checked per channel (#109), so one bad channel in a backup is reported while
 * the others still import.
 */
export function connectorDirectionError(entry: ChannelExportEntry): string | null {
  if (!isSourceConnectorType(entry.sourceConnectorType)) {
    return `Channel "${entry.name}": ${entry.sourceConnectorType} cannot be a source; not imported`;
  }
  const bad = entry.destinations.find((d) => !isDestinationConnectorType(d.connectorType));
  if (bad) {
    return `Channel "${entry.name}": destination "${bad.name}" uses ${bad.connectorType}, which cannot be a destination; not imported`;
  }
  return null;
}

interface ImportRun {
  readonly context: AuditContext | undefined;
  readonly placement: ImportPlacement;
}

type ImportTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function importSingleChannel(
  entry: ChannelExportEntry,
  mode: CollisionMode,
  run: ImportRun,
): Promise<ImportOutcome> {
  const directionError = connectorDirectionError(entry);
  if (directionError) return directionError;
  try {
    const [existing] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.id, entry.id), isNull(channels.deletedAt)));

    if (existing) {
      if (mode === 'SKIP') return 'skipped';
      if (mode === 'OVERWRITE') return await overwriteChannel(entry, run);
      return await createChannel({ ...entry, id: randomUUID() }, run);
    }

    return await createChannel(entry, run);
  } catch (err) {
    return `Error importing "${entry.name}": ${importErrorText(err)}`;
  }
}

/** Drizzle's message lists the statement's parameters, which can hold stored credentials. Its cause is the database's own error. */
function importErrorText(err: unknown): string {
  const reported = err instanceof DrizzleQueryError ? err.cause ?? 'a database statement failed' : err;
  return reported instanceof Error ? reported.message : String(reported);
}

type ImportedColumns = Omit<typeof channels.$inferInsert, 'id' | 'enabled' | 'revision' | 'createdAt' | 'updatedAt'>;

/**
 * Drizzle leaves out an undefined column, so a file with no script timeout gives
 * a new channel the default and an overwritten one keeps its own.
 */
function importedColumns(entry: ChannelExportEntry): ImportedColumns {
  return {
    name: entry.name,
    description: entry.description,
    inboundDataType: entry.inboundDataType,
    outboundDataType: entry.outboundDataType,
    sourceConnectorType: entry.sourceConnectorType,
    sourceConnectorProperties: stripRedactedProperties(entry.sourceConnectorProperties),
    responseMode: entry.responseMode,
    responseConnectorName: entry.responseConnectorName,
    initialState: entry.initialState,
    messageStorageMode: entry.messageStorageMode,
    encryptData: entry.encryptData,
    removeContentOnCompletion: entry.removeContentOnCompletion,
    removeAttachmentsOnCompletion: entry.removeAttachmentsOnCompletion,
    pruningEnabled: entry.pruningEnabled,
    pruningMaxAgeDays: entry.pruningMaxAgeDays,
    pruningArchiveEnabled: entry.pruningArchiveEnabled,
    scriptTimeoutSeconds: entry.scriptTimeoutSeconds,
  };
}

async function createChannel(
  entry: ChannelExportEntry,
  run: ImportRun,
): Promise<'created'> {
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(channels).values({
      ...importedColumns(entry),
      id: entry.id,
      enabled: entry.enabled,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });

    await insertRelations(tx, entry.id, entry);
    if (run.placement !== 'restore') {
      await GrantService.placeNewChannel(tx, entry.id, run.placement.groupId, { userId: run.context?.userId ?? null, ipAddress: run.context?.ipAddress ?? null });
    }

    // Partitions in the same transaction: a channel without them would put its
    // messages in the default partitions, so a failure rolls it back (#260).
    // Last, because it locks the six message tables until commit.
    const partitions = await PartitionManagerService.createPartitions(entry.id, tx);
    if (!partitions.ok) {
      throw new Error(`its message partitions could not be created, so it was not imported: ${partitions.error.message}`);
    }
  });

  return 'created';
}

async function mayOverwrite(tx: ImportTx, channelId: string, run: ImportRun): Promise<boolean> {
  if (run.placement === 'restore') return true;
  const userId = run.context?.userId;
  const standing = userId ? await queryUserStanding(tx, userId) : null;
  if (standing?.enabled !== true) return false;
  const groupIds = (await tx.select({ id: channelGroupMembers.channelGroupId }).from(channelGroupMembers)
    .where(eq(channelGroupMembers.channelId, channelId))).map((r) => r.id as ChannelGroupId);
  return can(standing.grants, PERMISSIONS.CHANNELS_WRITE, { groupIds });
}

/**
 * Judged after the channel row is locked FOR UPDATE, which a membership change
 * and a delete lock too: the channel cannot leave the importer's scope, or be
 * deleted, between this check and the write.
 */
async function overwriteRefusal(tx: ImportTx, channelId: string, run: ImportRun): Promise<string | null> {
  const [live] = await tx.select({ id: channels.id }).from(channels)
    .where(and(eq(channels.id, channelId), isNull(channels.deletedAt))).for('update');
  if (!(await mayOverwrite(tx, channelId, run))) return 'it would replace a channel you cannot change';
  return live ? null : 'it was deleted while the import waited for it';
}

/** The entry with the stored credentials it may keep (D-335). Needs the lock overwriteRefusal takes, or a save under way would be undone. */
async function withStoredCredentials(tx: ImportTx, entry: ChannelExportEntry): Promise<ChannelExportEntry> {
  const [source] = await tx
    .select({ connectorType: channels.sourceConnectorType, properties: channels.sourceConnectorProperties })
    .from(channels).where(eq(channels.id, entry.id));
  const destinations = await tx
    .select({
      metaDataId: channelConnectors.metaDataId, name: channelConnectors.name,
      connectorType: channelConnectors.connectorType, properties: channelConnectors.properties,
    })
    .from(channelConnectors).where(eq(channelConnectors.channelId, entry.id));
  const importedSource = { connectorType: entry.sourceConnectorType, properties: entry.sourceConnectorProperties };
  return {
    ...entry,
    sourceConnectorProperties: overwriteProperties('source', importedSource, source),
    destinations: entry.destinations.map((d) => ({
      ...d, properties: overwriteProperties('destination', d, sameDestination(d, entry.destinations, destinations)),
    })),
  };
}

async function overwriteChannel(file: ChannelExportEntry, run: ImportRun): Promise<ImportOutcome> {
  const now = new Date();

  return db.transaction(async (tx) => {
    const refusal = await overwriteRefusal(tx, file.id, run);
    if (refusal !== null) return `Channel "${file.name}": not imported; ${refusal}`;
    const entry = await withStoredCredentials(tx, file);
    // An import keeps the stored enabled flag, which is deploy control (#225);
    // a restore sets it. The revision goes up so an editor opened before gets a conflict.
    await tx.update(channels).set({
      ...importedColumns(entry),
      ...(run.placement === 'restore' ? { enabled: entry.enabled } : {}),
      revision: sql`${channels.revision} + 1`,
      updatedAt: now,
    }).where(eq(channels.id, entry.id));

    await tx.delete(channelScripts).where(eq(channelScripts.channelId, entry.id));
    await tx.delete(channelConnectors).where(eq(channelConnectors.channelId, entry.id));
    await tx.delete(channelMetadataColumns).where(eq(channelMetadataColumns.channelId, entry.id));
    await tx.delete(channelFilters).where(eq(channelFilters.channelId, entry.id));
    await tx.delete(channelTransformers).where(eq(channelTransformers.channelId, entry.id));

    await insertRelations(tx, entry.id, entry);
    return 'updated';
  });
}

interface ConnectorRef {
  readonly connectorId: string | null;
  readonly metaDataId?: number | null | undefined;
}

/**
 * Null for the source. A reference by the exporting server's row id alone
 * cannot be resolved here, so it fails the channel's import rather than
 * attaching the script to the wrong connector.
 */
export function resolveConnectorId(ref: ConnectorRef, destIdByMetaDataId: ReadonlyMap<number, string>, what: string): string | null {
  if (ref.metaDataId !== undefined && ref.metaDataId !== null) {
    const id = destIdByMetaDataId.get(ref.metaDataId);
    if (!id) throw new Error(`${what} belongs to destination ${String(ref.metaDataId)}, which the channel does not have`);
    return id;
  }
  if (ref.connectorId === null) return null;
  throw new Error(`${what} names its destination only by a connector id from another server; export the channel again`);
}

async function insertRelations(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  channelId: string,
  entry: ChannelExportEntry,
): Promise<void> {
  if (entry.scripts.length > 0) {
    await tx.insert(channelScripts).values(
      entry.scripts.map((s) => ({
        channelId,
        scriptType: s.scriptType,
        script: s.script,
        language: toScriptLanguage(s.language),
      })),
    );
  }

  const destIdByMetaDataId = new Map<number, string>();
  if (entry.destinations.length > 0) {
    const insertedDestinations = await tx.insert(channelConnectors).values(
      entry.destinations.map((d) => ({
        channelId,
        metaDataId: d.metaDataId,
        name: d.name,
        enabled: d.enabled,
        connectorType: d.connectorType,
        properties: stripRedactedProperties(d.properties),
        queueMode: d.queueMode,
        retryCount: d.retryCount,
        retryIntervalMs: d.retryIntervalMs,
        rotateQueue: d.rotateQueue,
        queueThreadCount: d.queueThreadCount,
        waitForPrevious: d.waitForPrevious,
        responseTransformer: d.responseTransformer ?? null,
        responseTransformerLanguage: toScriptLanguage(d.responseTransformerLanguage),
      })),
    ).returning({ id: channelConnectors.id, metaDataId: channelConnectors.metaDataId });
    for (const row of insertedDestinations) destIdByMetaDataId.set(row.metaDataId, row.id);
  }
  const connectorFor = (ref: ConnectorRef, what: string): string | null =>
    resolveConnectorId(ref, destIdByMetaDataId, `${what} of "${entry.name}"`);

  if (entry.metadataColumns.length > 0) {
    await tx.insert(channelMetadataColumns).values(
      entry.metadataColumns.map((m) => ({
        channelId,
        name: m.name,
        dataType: m.dataType,
        mappingExpression: m.mappingExpression,
      })),
    );
  }

  for (const filter of entry.filters) {
    const [inserted] = await tx
      .insert(channelFilters)
      .values({ channelId, connectorId: connectorFor(filter, 'a filter') })
      .returning({ id: channelFilters.id });

    if (inserted && filter.rules.length > 0) {
      await tx.insert(filterRules).values(
        filter.rules.map((r, idx) => ({
          filterId: inserted.id,
          sequenceNumber: idx,
          enabled: r.enabled,
          name: r.name,
          operator: r.operator,
          type: r.type,
          script: r.script,
          language: toScriptLanguage(r.language),
          field: r.field,
          condition: r.condition,
          values: r.values,
        })),
      );
    }
  }

  for (const transformer of entry.transformers) {
    const [inserted] = await tx
      .insert(channelTransformers)
      .values({
        channelId,
        connectorId: connectorFor(transformer, 'a transformer'),
        inboundDataType: transformer.inboundDataType,
        outboundDataType: transformer.outboundDataType,
        inboundProperties: transformer.inboundProperties,
        outboundProperties: transformer.outboundProperties,
        inboundTemplate: transformer.inboundTemplate,
        outboundTemplate: transformer.outboundTemplate,
      })
      .returning({ id: channelTransformers.id });

    if (inserted && transformer.steps.length > 0) {
      await tx.insert(transformerSteps).values(
        transformer.steps.map((s, idx) => ({
          transformerId: inserted.id,
          sequenceNumber: idx,
          enabled: s.enabled,
          name: s.name,
          type: s.type,
          script: s.script,
          language: toScriptLanguage(s.language),
          sourceField: s.sourceField,
          targetField: s.targetField,
          defaultValue: s.defaultValue,
          mapping: s.mapping,
        })),
      );
    }
  }
}
