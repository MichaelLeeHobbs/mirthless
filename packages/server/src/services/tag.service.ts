// ===========================================
// Tag Service
// ===========================================
// Business logic for channel tag CRUD + assignment.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, count, asc } from 'drizzle-orm';
import type { CreateTagInput, UpdateTagInput } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { channelTags, channelTagAssignments, channels } from '../db/schema/index.js';

// ----- Response Types -----

export interface TagSummary {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
  readonly assignmentCount: number;
}

// ----- Service -----

export class TagService {
  /** List all tags with assignment counts. */
  static async listTags(): Promise<Result<readonly TagSummary[]>> {
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
          .where(eq(channelTagAssignments.tagId, tag.id));

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

  /** List all tag-channel assignments. */
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

  /** Create a new tag. */
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
        throw new ServiceError('ALREADY_EXISTS', `Tag "${input.name}" already exists`);
      }

      const [row] = await db
        .insert(channelTags)
        .values({
          name: input.name,
          color: input.color,
        })
        .returning();

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

  /** Update a tag. */
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
          throw new ServiceError('ALREADY_EXISTS', `Tag "${input.name}" already exists`);
        }
      }

      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates['name'] = input.name;
      if (input.color !== undefined) updates['color'] = input.color;

      const [row] = await db
        .update(channelTags)
        .set(updates)
        .where(eq(channelTags.id, id))
        .returning();

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

  /** Delete a tag (cascades assignments). */
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

  /** Assign a tag to a channel. */
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
        throw new ServiceError('ALREADY_EXISTS', 'Tag is already assigned to this channel');
      }

      await db
        .insert(channelTagAssignments)
        .values({ tagId, channelId });

      emitEvent({
        level: 'INFO', name: 'TAG_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'assign', tagId, channelId },
      });
    });
  }

  /** Unassign a tag from a channel. */
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
