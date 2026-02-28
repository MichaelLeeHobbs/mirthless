// ===========================================
// Channel Service
// ===========================================
// Business logic for channel CRUD operations.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, isNull, and, count, asc } from 'drizzle-orm';
import type {
  CreateChannelInput,
  UpdateChannelInput,
  ChannelListQuery,
} from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import {
  channels,
  channelScripts,
  channelConnectors,
  channelMetadataColumns,
  channelTagAssignments,
  channelTags,
} from '../db/schema/index.js';

// ----- Response Types -----

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

export interface ChannelScript {
  readonly id: string;
  readonly scriptType: string;
  readonly script: string;
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
  readonly sourceConnectorProperties: Record<string, unknown>;
  readonly scripts: readonly ChannelScript[];
  readonly destinations: readonly ChannelDestination[];
  readonly metadataColumns: readonly ChannelMetadataCol[];
  readonly tags: readonly ChannelTagInfo[];
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

// ----- Default Scripts -----

const DEFAULT_SCRIPT_TYPES = ['DEPLOY', 'UNDEPLOY', 'PREPROCESSOR', 'POSTPROCESSOR'] as const;

// ----- Private Helpers -----

async function findChannel(id: string): Promise<typeof channels.$inferSelect> {
  const [channel] = await db
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
}

async function fetchChannelRelations(id: string): Promise<ChannelRelations> {
  const [scriptRows, destinationRows, metadataRows, tagRows] = await Promise.all([
    db
      .select({ id: channelScripts.id, scriptType: channelScripts.scriptType, script: channelScripts.script })
      .from(channelScripts)
      .where(eq(channelScripts.channelId, id)),
    db
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
      })
      .from(channelConnectors)
      .where(eq(channelConnectors.channelId, id))
      .orderBy(asc(channelConnectors.metaDataId)),
    db
      .select({
        id: channelMetadataColumns.id,
        name: channelMetadataColumns.name,
        dataType: channelMetadataColumns.dataType,
        mappingExpression: channelMetadataColumns.mappingExpression,
      })
      .from(channelMetadataColumns)
      .where(eq(channelMetadataColumns.channelId, id)),
    db
      .select({ id: channelTags.id, name: channelTags.name, color: channelTags.color })
      .from(channelTagAssignments)
      .innerJoin(channelTags, eq(channelTagAssignments.tagId, channelTags.id))
      .where(eq(channelTagAssignments.channelId, id)),
  ]);

  return { scripts: scriptRows, destinations: destinationRows, metadataColumns: metadataRows, tags: tagRows };
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
    sourceConnectorProperties: channel.sourceConnectorProperties,
    scripts: relations.scripts,
    destinations: relations.destinations,
    metadataColumns: relations.metadataColumns,
    tags: relations.tags,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}

// ----- Service -----

export class ChannelService {
  /** List channels with pagination. */
  static async list(query: ChannelListQuery): Promise<Result<ChannelListResult>> {
    return tryCatch(async () => {
      const offset = (query.page - 1) * query.pageSize;

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
          .where(isNull(channels.deletedAt))
          .orderBy(channels.name)
          .limit(query.pageSize)
          .offset(offset),
        db
          .select({ total: count() })
          .from(channels)
          .where(isNull(channels.deletedAt)),
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

  /** Get full channel detail by ID. */
  static async getById(id: string): Promise<Result<ChannelDetail>> {
    return tryCatch(async () => {
      const channel = await findChannel(id);
      const relations = await fetchChannelRelations(id);
      return assembleDetail(channel, relations);
    });
  }

  /** Create a new channel with default scripts. */
  static async create(input: CreateChannelInput): Promise<Result<ChannelDetail>> {
    return tryCatch(async () => {
      // Check name uniqueness among non-deleted channels
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
      }

      // Transaction: insert channel + default scripts + destinations + metadata columns
      const [created] = await db.transaction(async (tx) => {
        const inserted = await tx.insert(channels).values(channelValues).returning();

        const channelId = inserted[0]!.id;

        // Insert default scripts (using input.scripts if provided)
        const scriptValues = DEFAULT_SCRIPT_TYPES.map((scriptType) => {
          const key = scriptType.toLowerCase() as 'deploy' | 'undeploy' | 'preprocessor' | 'postprocessor';
          return {
            channelId,
            scriptType,
            script: input.scripts?.[key] ?? '',
          };
        });

        await tx.insert(channelScripts).values(scriptValues);

        // Insert destinations if provided
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
          }));
          await tx.insert(channelConnectors).values(destValues);
        }

        // Insert metadata columns if provided
        if (input.metadataColumns && input.metadataColumns.length > 0) {
          const metaValues = input.metadataColumns.map((col) => ({
            channelId,
            name: col.name,
            dataType: col.dataType,
            mappingExpression: col.mappingExpression,
          }));
          await tx.insert(channelMetadataColumns).values(metaValues);
        }

        return inserted;
      });

      // Return full detail
      const channel = created!;
      const relations = await fetchChannelRelations(channel.id);
      return assembleDetail(channel, relations);
    });
  }

  /** Update a channel with optimistic locking via revision. */
  static async update(id: string, input: UpdateChannelInput): Promise<Result<ChannelDetail>> {
    return tryCatch(async () => {
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
      }

      // Check name uniqueness if name is changing
      if (input.name !== undefined && input.name !== existing.name) {
        const [duplicate] = await db
          .select({ id: channels.id })
          .from(channels)
          .where(and(eq(channels.name, input.name), isNull(channels.deletedAt)));

        if (duplicate) {
          throw new ServiceError('ALREADY_EXISTS', `Channel with name "${input.name}" already exists`);
        }
      }

      await db.update(channels).set(updateValues).where(eq(channels.id, id));

      // Update scripts if provided
      if (input.scripts) {
        for (const [key, value] of Object.entries(input.scripts)) {
          if (value !== undefined) {
            const scriptType = key.toUpperCase();
            await db
              .update(channelScripts)
              .set({ script: value ?? '' })
              .where(and(eq(channelScripts.channelId, id), eq(channelScripts.scriptType, scriptType)));
          }
        }
      }

      // Sync destinations if provided (delete-and-reinsert)
      if (input.destinations) {
        await db.delete(channelConnectors).where(eq(channelConnectors.channelId, id));

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
          }));
          await db.insert(channelConnectors).values(destValues);
        }
      }

      // Sync metadata columns if provided (delete-and-reinsert)
      if (input.metadataColumns) {
        await db.delete(channelMetadataColumns).where(eq(channelMetadataColumns.channelId, id));

        if (input.metadataColumns.length > 0) {
          const metaValues = input.metadataColumns.map((col) => ({
            channelId: id,
            name: col.name,
            dataType: col.dataType,
            mappingExpression: col.mappingExpression,
          }));
          await db.insert(channelMetadataColumns).values(metaValues);
        }
      }

      const channel = await findChannel(id);
      const relations = await fetchChannelRelations(id);
      return assembleDetail(channel, relations);
    });
  }

  /** Soft-delete a channel by setting deletedAt. */
  static async delete(id: string): Promise<Result<void>> {
    return tryCatch(async () => {
      await findChannel(id);
      await db.update(channels).set({ deletedAt: new Date() }).where(eq(channels.id, id));
    });
  }

  /** Toggle channel enabled flag. */
  static async setEnabled(id: string, enabled: boolean): Promise<Result<ChannelDetail>> {
    return tryCatch(async () => {
      await findChannel(id);

      await db
        .update(channels)
        .set({ enabled, updatedAt: new Date() })
        .where(eq(channels.id, id));

      const channel = await findChannel(id);
      const relations = await fetchChannelRelations(id);
      return assembleDetail(channel, relations);
    });
  }
}
