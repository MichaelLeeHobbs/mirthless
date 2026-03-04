// ===========================================
// Channel Group Service
// ===========================================
// Business logic for channel group CRUD + member management.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, count, asc } from 'drizzle-orm';
import { DEFAULT_GROUP_NAME, type CreateChannelGroupInput, type UpdateChannelGroupInput } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { channelGroups, channelGroupMembers, channels } from '../db/schema/index.js';

// ----- Response Types -----

export interface ChannelGroupSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly revision: number;
  readonly memberCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ChannelGroupDetail extends ChannelGroupSummary {
  readonly channels: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

// ----- Service -----

export class ChannelGroupService {
  /** List all groups with member counts. */
  static async listGroups(): Promise<Result<readonly ChannelGroupSummary[]>> {
    return tryCatch(async () => {
      const groups = await db
        .select()
        .from(channelGroups)
        .orderBy(asc(channelGroups.name));

      const summaries: ChannelGroupSummary[] = [];

      for (const group of groups) {
        const [countRow] = await db
          .select({ value: count() })
          .from(channelGroupMembers)
          .where(eq(channelGroupMembers.channelGroupId, group.id));

        summaries.push({
          id: group.id,
          name: group.name,
          description: group.description,
          revision: group.revision,
          memberCount: countRow?.value ?? 0,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
        });
      }

      return summaries;
    });
  }

  /** List all group-channel memberships. */
  static async listMemberships(): Promise<Result<ReadonlyArray<{ readonly channelGroupId: string; readonly channelId: string }>>> {
    return tryCatch(async () => {
      const rows = await db
        .select({
          channelGroupId: channelGroupMembers.channelGroupId,
          channelId: channelGroupMembers.channelId,
        })
        .from(channelGroupMembers);

      return rows;
    });
  }

  /** Get a single group by ID with its member channels. */
  static async getById(id: string): Promise<Result<ChannelGroupDetail>> {
    return tryCatch(async () => {
      const [group] = await db
        .select()
        .from(channelGroups)
        .where(eq(channelGroups.id, id));

      if (!group) {
        throw new ServiceError('NOT_FOUND', `Channel group ${id} not found`);
      }

      const members = await db
        .select({
          id: channels.id,
          name: channels.name,
        })
        .from(channelGroupMembers)
        .innerJoin(channels, eq(channelGroupMembers.channelId, channels.id))
        .where(eq(channelGroupMembers.channelGroupId, id));

      return {
        id: group.id,
        name: group.name,
        description: group.description,
        revision: group.revision,
        memberCount: members.length,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        channels: members,
      };
    });
  }

  /** Create a new group. */
  static async create(
    input: CreateChannelGroupInput,
    context?: AuditContext,
  ): Promise<Result<ChannelGroupSummary>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: channelGroups.id })
        .from(channelGroups)
        .where(eq(channelGroups.name, input.name));

      if (existing) {
        throw new ServiceError('ALREADY_EXISTS', `Channel group "${input.name}" already exists`);
      }

      const [row] = await db
        .insert(channelGroups)
        .values({
          name: input.name,
          description: input.description,
        })
        .returning();

      emitEvent({
        level: 'INFO', name: 'CHANNEL_GROUP_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'create', groupName: input.name },
      });

      return {
        id: row!.id,
        name: row!.name,
        description: row!.description,
        revision: row!.revision,
        memberCount: 0,
        createdAt: row!.createdAt,
        updatedAt: row!.updatedAt,
      };
    });
  }

  /** Update a group (optimistic locking). */
  static async update(
    id: string,
    input: UpdateChannelGroupInput,
    context?: AuditContext,
  ): Promise<Result<ChannelGroupSummary>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select()
        .from(channelGroups)
        .where(eq(channelGroups.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Channel group ${id} not found`);
      }

      if (existing.revision !== input.revision) {
        throw new ServiceError('CONFLICT', 'Channel group has been modified by another user');
      }

      if (input.name && input.name !== existing.name) {
        const [dup] = await db
          .select({ id: channelGroups.id })
          .from(channelGroups)
          .where(eq(channelGroups.name, input.name));

        if (dup) {
          throw new ServiceError('ALREADY_EXISTS', `Channel group "${input.name}" already exists`);
        }
      }

      const updates: Record<string, unknown> = {
        revision: existing.revision + 1,
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updates['name'] = input.name;
      if (input.description !== undefined) updates['description'] = input.description;

      const [row] = await db
        .update(channelGroups)
        .set(updates)
        .where(eq(channelGroups.id, id))
        .returning();

      const [countRow] = await db
        .select({ value: count() })
        .from(channelGroupMembers)
        .where(eq(channelGroupMembers.channelGroupId, id));

      emitEvent({
        level: 'INFO', name: 'CHANNEL_GROUP_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'update', groupId: id },
      });

      return {
        id: row!.id,
        name: row!.name,
        description: row!.description,
        revision: row!.revision,
        memberCount: countRow?.value ?? 0,
        createdAt: row!.createdAt,
        updatedAt: row!.updatedAt,
      };
    });
  }

  /** Delete a group (cascades members). The "Default" group cannot be deleted. */
  static async delete(id: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: channelGroups.id, name: channelGroups.name })
        .from(channelGroups)
        .where(eq(channelGroups.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Channel group ${id} not found`);
      }

      if (existing.name === DEFAULT_GROUP_NAME) {
        throw new ServiceError('FORBIDDEN', `The "${DEFAULT_GROUP_NAME}" channel group cannot be deleted`);
      }

      await db
        .delete(channelGroups)
        .where(eq(channelGroups.id, id));

      emitEvent({
        level: 'INFO', name: 'CHANNEL_GROUP_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'delete', groupId: id },
      });
    });
  }

  /** Add a channel to a group. */
  static async addMember(
    groupId: string,
    channelId: string,
    context?: AuditContext,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const [group] = await db
        .select({ id: channelGroups.id })
        .from(channelGroups)
        .where(eq(channelGroups.id, groupId));

      if (!group) {
        throw new ServiceError('NOT_FOUND', `Channel group ${groupId} not found`);
      }

      const [channel] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.id, channelId));

      if (!channel) {
        throw new ServiceError('NOT_FOUND', `Channel ${channelId} not found`);
      }

      const [existing] = await db
        .select({ channelGroupId: channelGroupMembers.channelGroupId })
        .from(channelGroupMembers)
        .where(and(
          eq(channelGroupMembers.channelGroupId, groupId),
          eq(channelGroupMembers.channelId, channelId),
        ));

      if (existing) {
        throw new ServiceError('ALREADY_EXISTS', 'Channel is already a member of this group');
      }

      await db
        .insert(channelGroupMembers)
        .values({ channelGroupId: groupId, channelId });

      emitEvent({
        level: 'INFO', name: 'CHANNEL_GROUP_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'addMember', groupId, channelId },
      });
    });
  }

  /** Remove a channel from a group. */
  static async removeMember(
    groupId: string,
    channelId: string,
    context?: AuditContext,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ channelGroupId: channelGroupMembers.channelGroupId })
        .from(channelGroupMembers)
        .where(and(
          eq(channelGroupMembers.channelGroupId, groupId),
          eq(channelGroupMembers.channelId, channelId),
        ));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', 'Channel is not a member of this group');
      }

      await db
        .delete(channelGroupMembers)
        .where(and(
          eq(channelGroupMembers.channelGroupId, groupId),
          eq(channelGroupMembers.channelId, channelId),
        ));

      emitEvent({
        level: 'INFO', name: 'CHANNEL_GROUP_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'removeMember', groupId, channelId },
      });
    });
  }
}
