import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, count, asc } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { ALL_CHANNELS, type CreateTagInput, type UpdateTagInput } from '@galvanigraph/core-models';
import { channelIdIn, type ChannelScope } from '../lib/channel-scope.js';
import { ServiceError } from '../lib/service-error.js';
import { uniqueConstraint } from '../lib/pg-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { channelTags, channelTagAssignments, channels } from '../db/schema/index.js';

export interface TagSummary {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
  readonly assignmentCount: number;
}

function nameTaken(name: string): ServiceError {
  return new ServiceError('ALREADY_EXISTS', `Tag "${name}" already exists`);
}

function alreadyAssigned(): ServiceError {
  return new ServiceError('ALREADY_EXISTS', 'Tag is already assigned to this channel');
}

const ASSIGNMENT_KEY = getTableConfig(channelTagAssignments).primaryKeys[0]?.getName();

export class TagService {
  /** `scope` is the reader's settings:read channels; only those are counted. */
  static async listTags(scope: ChannelScope = ALL_CHANNELS): Promise<Result<readonly TagSummary[]>> {
    return tryCatch(async () => {
      const tags = await db
        .select()
        .from(channelTags)
        .orderBy(asc(channelTags.name));

      const summaries: TagSummary[] = [];

      for (const tag of tags) {
        const [countRow] = await db
          .select({ value: count() })
          .from(channelTagAssignments)
          .where(and(eq(channelTagAssignments.tagId, tag.id), channelIdIn(channelTagAssignments.channelId, scope)));

        summaries.push({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          assignmentCount: countRow?.value ?? 0,
        });
      }

      return summaries;
    });
  }

  static async listAssignments(): Promise<Result<ReadonlyArray<{ readonly tagId: string; readonly channelId: string }>>> {
    return tryCatch(async () => {
      const rows = await db
        .select({
          tagId: channelTagAssignments.tagId,
          channelId: channelTagAssignments.channelId,
        })
        .from(channelTagAssignments);

      return rows;
    });
  }

  static async create(
    input: CreateTagInput,
    context?: AuditContext,
  ): Promise<Result<TagSummary>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: channelTags.id })
        .from(channelTags)
        .where(eq(channelTags.name, input.name));

      if (existing) {
        throw nameTaken(input.name);
      }

      // Two requests at once can both pass the check above; the one that loses gets its answer.
      const [row] = await db
        .insert(channelTags)
        .values({
          name: input.name,
          color: input.color,
        })
        .returning()
        .catch((err: unknown) => { throw uniqueConstraint(err) === channelTags.name.uniqueName ? nameTaken(input.name) : err; });

      emitEvent({
        level: 'INFO', name: 'TAG_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'create', tagName: input.name },
      });

      return {
        id: row!.id,
        name: row!.name,
        color: row!.color,
        assignmentCount: 0,
      };
    });
  }

  static async update(
    id: string,
    input: UpdateTagInput,
    context?: AuditContext,
  ): Promise<Result<TagSummary>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select()
        .from(channelTags)
        .where(eq(channelTags.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Tag ${id} not found`);
      }

      if (input.name && input.name !== existing.name) {
        const [dup] = await db
          .select({ id: channelTags.id })
          .from(channelTags)
          .where(eq(channelTags.name, input.name));

        if (dup) {
          throw nameTaken(input.name);
        }
      }

      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates['name'] = input.name;
      if (input.color !== undefined) updates['color'] = input.color;

      // Tags have no updatedAt column, so an empty input leaves nothing to SET,
      // and Drizzle rejects set({}). Nothing to change: return the tag as it is.
      const [row] = Object.keys(updates).length === 0
        ? [existing]
        : await db
          .update(channelTags)
          .set(updates)
          .where(eq(channelTags.id, id))
          .returning()
          .catch((err: unknown) => { throw input.name && uniqueConstraint(err) === channelTags.name.uniqueName ? nameTaken(input.name) : err; });

      const [countRow] = await db
        .select({ value: count() })
        .from(channelTagAssignments)
        .where(eq(channelTagAssignments.tagId, id));

      emitEvent({
        level: 'INFO', name: 'TAG_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'update', tagId: id },
      });

      return {
        id: row!.id,
        name: row!.name,
        color: row!.color,
        assignmentCount: countRow?.value ?? 0,
      };
    });
  }

  static async delete(id: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: channelTags.id })
        .from(channelTags)
        .where(eq(channelTags.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Tag ${id} not found`);
      }

      await db
        .delete(channelTags)
        .where(eq(channelTags.id, id));

      emitEvent({
        level: 'INFO', name: 'TAG_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'delete', tagId: id },
      });
    });
  }

  static async assign(
    tagId: string,
    channelId: string,
    context?: AuditContext,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const [tag] = await db
        .select({ id: channelTags.id })
        .from(channelTags)
        .where(eq(channelTags.id, tagId));

      if (!tag) {
        throw new ServiceError('NOT_FOUND', `Tag ${tagId} not found`);
      }

      const [channel] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.id, channelId));

      if (!channel) {
        throw new ServiceError('NOT_FOUND', `Channel ${channelId} not found`);
      }

      const [existing] = await db
        .select({ tagId: channelTagAssignments.tagId })
        .from(channelTagAssignments)
        .where(and(
          eq(channelTagAssignments.tagId, tagId),
          eq(channelTagAssignments.channelId, channelId),
        ));

      if (existing) {
        throw alreadyAssigned();
      }

      await db
        .insert(channelTagAssignments)
        .values({ tagId, channelId })
        .catch((err: unknown) => { throw uniqueConstraint(err) === ASSIGNMENT_KEY ? alreadyAssigned() : err; });

      emitEvent({
        level: 'INFO', name: 'TAG_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'assign', tagId, channelId },
      });
    });
  }

  static async unassign(
    tagId: string,
    channelId: string,
    context?: AuditContext,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ tagId: channelTagAssignments.tagId })
        .from(channelTagAssignments)
        .where(and(
          eq(channelTagAssignments.tagId, tagId),
          eq(channelTagAssignments.channelId, channelId),
        ));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', 'Tag is not assigned to this channel');
      }

      await db
        .delete(channelTagAssignments)
        .where(and(
          eq(channelTagAssignments.tagId, tagId),
          eq(channelTagAssignments.channelId, channelId),
        ));

      emitEvent({
        level: 'INFO', name: 'TAG_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'unassign', tagId, channelId },
      });
    });
  }
}
