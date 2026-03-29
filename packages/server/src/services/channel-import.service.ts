// ===========================================
// Channel Import Service
// ===========================================
// Imports channels from a structured JSON export payload.
// Supports collision handling: SKIP, OVERWRITE, CREATE_NEW.

import { tryCatch, type Result } from 'stderr-lib';
import { randomUUID } from 'node:crypto';
import { eq, isNull, and } from 'drizzle-orm';
import type { ChannelExportEntry, CollisionMode, ImportResult } from '@mirthless/core-models';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { PartitionManagerService } from './partition-manager.service.js';
import logger from '../lib/logger.js';
import {
  channels,
  channelScripts,
  channelConnectors,
  channelMetadataColumns,
  channelFilters,
  filterRules,
  channelTransformers,
  transformerSteps,
} from '../db/schema/index.js';

// ----- Service -----

export class ChannelImportService {
  /** Import channels with collision handling. */
  static async importChannels(
    entries: readonly ChannelExportEntry[],
    collisionMode: CollisionMode,
    context?: AuditContext,
  ): Promise<Result<ImportResult>> {
    return tryCatch(async () => {
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const entry of entries) {
        const result = await importSingleChannel(entry, collisionMode, context);
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

async function importSingleChannel(
  entry: ChannelExportEntry,
  mode: CollisionMode,
  context?: AuditContext,
): Promise<ImportOutcome> {
  try {
    // Check if channel with this ID already exists
    const [existing] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.id, entry.id), isNull(channels.deletedAt)));

    if (existing) {
      if (mode === 'SKIP') return 'skipped';
      if (mode === 'OVERWRITE') {
        await overwriteChannel(entry);
        return 'updated';
      }
      // CREATE_NEW: assign a new ID
      return await createChannel({ ...entry, id: randomUUID() }, context);
    }

    // No collision — create directly
    return await createChannel(entry, context);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error importing "${entry.name}": ${msg}`;
  }
}

async function createChannel(
  entry: ChannelExportEntry,
  _context?: AuditContext,
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
      sourceConnectorProperties: entry.sourceConnectorProperties,
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
  });

  // Create partitions (non-blocking)
  const partResult = await PartitionManagerService.createPartitions(entry.id);
  if (!partResult.ok) {
    logger.warn({ channelId: entry.id, errMsg: partResult.error.message }, 'Failed to create partitions for imported channel');
  }

  return 'created';
}

async function overwriteChannel(entry: ChannelExportEntry): Promise<void> {
  const now = new Date();

  await db.transaction(async (tx) => {
    // Update channel core fields
    await tx.update(channels).set({
      name: entry.name,
      description: entry.description,
      enabled: entry.enabled,
      inboundDataType: entry.inboundDataType,
      outboundDataType: entry.outboundDataType,
      sourceConnectorType: entry.sourceConnectorType,
      sourceConnectorProperties: entry.sourceConnectorProperties,
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
  });
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
      })),
    );
  }

  // Destinations
  if (entry.destinations.length > 0) {
    await tx.insert(channelConnectors).values(
      entry.destinations.map((d) => ({
        channelId,
        metaDataId: d.metaDataId,
        name: d.name,
        enabled: d.enabled,
        connectorType: d.connectorType,
        properties: d.properties,
        queueMode: d.queueMode,
        retryCount: d.retryCount,
        retryIntervalMs: d.retryIntervalMs,
        rotateQueue: d.rotateQueue,
        queueThreadCount: d.queueThreadCount,
        waitForPrevious: d.waitForPrevious,
      })),
    );
  }

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
      .values({ channelId, connectorId: filter.connectorId })
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
        connectorId: transformer.connectorId,
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
          sourceField: s.sourceField,
          targetField: s.targetField,
          defaultValue: s.defaultValue,
          mapping: s.mapping,
        })),
      );
    }
  }
}
