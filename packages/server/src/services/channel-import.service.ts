// ===========================================
// Channel Import Service
// ===========================================
// Imports channels from a structured JSON export payload.
// Supports collision handling: SKIP, OVERWRITE, CREATE_NEW.

import { tryCatch, type Result } from 'stderr-lib';
import { randomUUID } from 'node:crypto';
import { eq, isNull, and } from 'drizzle-orm';
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
import { queryUserStanding } from '../lib/principal.js';
import { REDACTED } from '../lib/secret-redaction.js';
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
import { isPlainObject } from '@galvanigraph/core-util';

/**
 * Exports mask connector credentials as REDACTED. Importing that marker verbatim
 * would write the literal "__REDACTED__" over (or in place of) a real password.
 * Strip any redacted-valued keys so the secret is simply absent and must be
 * re-entered — the connector fails loud at deploy if a required credential is
 * missing, rather than silently authenticating with a bogus value.
 */
export function stripRedactedProperties(props: unknown): Record<string, unknown> {
  if (!isPlainObject(props)) return {};
  const root: Record<string, unknown> = {};
  // Exports redact at any depth (nested auth/tls/headers), so strip at any depth.
  const stack: Array<[Record<string, unknown>, Record<string, unknown>]> = [[props, root]];
  while (stack.length > 0) {
    const [src, dst] = stack.pop()!;
    for (const [key, value] of Object.entries(src)) {
      if (value === REDACTED) continue;
      if (isPlainObject(value)) {
        const copy: Record<string, unknown> = {};
        dst[key] = copy;
        stack.push([value, copy]);
      } else if (Array.isArray(value)) {
        const kept = value.filter((item) => item !== REDACTED);
        const items: unknown[] = kept.map((item) => (isPlainObject(item) ? {} : item));
        dst[key] = items;
        kept.forEach((item, i) => {
          if (isPlainObject(item)) stack.push([item, items[i] as Record<string, unknown>]);
        });
      } else {
        dst[key] = value;
      }
    }
  }
  return root;
}

/**
 * Where an import puts channels (D-310): new channels join `groupId` or the
 * importer's default group (GrantService.placeNewChannel), and an overwrite
 * needs channels:write on the channel it replaces. A backup restore brings its
 * own memberships and runs under system:restore, which covers every channel,
 * so it does neither.
 */
export type ImportPlacement = { readonly groupId?: string } | 'restore';

// ----- Service -----

export class ChannelImportService {
  /** Import channels with collision handling. */
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

// ----- Helpers -----

type ImportOutcome = 'created' | 'updated' | 'skipped' | string;

/**
 * Why a channel's connectors can't run, or null. A source must be a type that
 * receives and each destination a type that sends (#109). Checked per channel so
 * one bad channel in a backup is reported while the others still import.
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

/** Who imports, and where their channels go. */
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
    // Check if channel with this ID already exists
    const [existing] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.id, entry.id), isNull(channels.deletedAt)));

    if (existing) {
      if (mode === 'SKIP') return 'skipped';
      if (mode === 'OVERWRITE') return await overwriteChannel(entry, run);
      // CREATE_NEW: assign a new ID
      return await createChannel({ ...entry, id: randomUUID() }, run);
    }

    // No collision — create directly
    return await createChannel(entry, run);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error importing "${entry.name}": ${msg}`;
  }
}

async function createChannel(
  entry: ChannelExportEntry,
  run: ImportRun,
): Promise<'created'> {
  const now = new Date();

  await db.transaction(async (tx) => {
    // Insert channel
    await tx.insert(channels).values({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      enabled: entry.enabled,
      revision: 1,
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

/**
 * Whether the importer may replace `channelId`, judged in the overwrite's own
 * transaction after the channel row is locked FOR UPDATE: a membership change
 * locks the same row, so the channel cannot leave the importer's scope between
 * this check and the write. A restore may replace any channel.
 */
async function mayOverwrite(tx: ImportTx, channelId: string, run: ImportRun): Promise<boolean> {
  await tx.select({ id: channels.id }).from(channels).where(eq(channels.id, channelId)).for('update');
  if (run.placement === 'restore') return true;
  const userId = run.context?.userId;
  const standing = userId ? await queryUserStanding(tx, userId) : null;
  if (standing?.enabled !== true) return false;
  const groupIds = (await tx.select({ id: channelGroupMembers.channelGroupId }).from(channelGroupMembers)
    .where(eq(channelGroupMembers.channelId, channelId))).map((r) => r.id as ChannelGroupId);
  return can(standing.grants, PERMISSIONS.CHANNELS_WRITE, { groupIds });
}

async function overwriteChannel(entry: ChannelExportEntry, run: ImportRun): Promise<ImportOutcome> {
  const now = new Date();

  return db.transaction(async (tx) => {
    if (!(await mayOverwrite(tx, entry.id, run))) {
      return `Channel "${entry.name}": not imported; it would replace a channel you cannot change`;
    }
    // Update channel core fields
    await tx.update(channels).set({
      name: entry.name,
      description: entry.description,
      enabled: entry.enabled,
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
      updatedAt: now,
    }).where(eq(channels.id, entry.id));

    // Delete existing relations
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
 * The new connector row a filter or transformer belongs to: null for the
 * source, else the destination its metaDataId names. A reference by the
 * exporting server's row id alone cannot be resolved here, so it fails the
 * channel's import rather than attaching the script to the wrong connector.
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
  // Scripts
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

  // Destinations
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

  // Metadata columns
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

  // Filters
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

  // Transformers
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
