// ===========================================
// Resource Service
// ===========================================
// Business logic for resource CRUD.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, asc } from 'drizzle-orm';
import type { CreateResourceInput, UpdateResourceInput } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { resources } from '../db/schema/index.js';

// ----- Response Types -----

export interface ResourceSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ResourceDetail extends ResourceSummary {
  readonly content: string | null;
}

// ----- Service -----

export class ResourceService {
  /** List all resources (metadata only, no content). */
  static async list(): Promise<Result<readonly ResourceSummary[]>> {
    return tryCatch(async () => {
      const rows = await db
        .select({
          id: resources.id,
          name: resources.name,
          description: resources.description,
          mimeType: resources.mimeType,
          sizeBytes: resources.sizeBytes,
          createdAt: resources.createdAt,
          updatedAt: resources.updatedAt,
        })
        .from(resources)
        .orderBy(asc(resources.name));

      return rows;
    });
  }

  /** Get a single resource by ID (with content). */
  static async getById(id: string): Promise<Result<ResourceDetail>> {
    return tryCatch(async () => {
      const [row] = await db
        .select()
        .from(resources)
        .where(eq(resources.id, id));

      if (!row) {
        throw new ServiceError('NOT_FOUND', `Resource ${id} not found`);
      }

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        content: row.content,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  /** Create a new resource. */
  static async create(
    input: CreateResourceInput,
    context?: AuditContext,
  ): Promise<Result<ResourceDetail>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: resources.id })
        .from(resources)
        .where(eq(resources.name, input.name));

      if (existing) {
        throw new ServiceError('ALREADY_EXISTS', `Resource "${input.name}" already exists`);
      }

      const sizeBytes = Buffer.byteLength(input.content, 'utf-8');

      const [row] = await db
        .insert(resources)
        .values({
          name: input.name,
          description: input.description,
          mimeType: input.mimeType,
          sizeBytes,
          content: input.content,
        })
        .returning();

      emitEvent({
        level: 'INFO', name: 'RESOURCE_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'create', resourceName: input.name },
      });

      return {
        id: row!.id,
        name: row!.name,
        description: row!.description,
        mimeType: row!.mimeType,
        sizeBytes: row!.sizeBytes,
        content: row!.content,
        createdAt: row!.createdAt,
        updatedAt: row!.updatedAt,
      };
    });
  }

  /** Update a resource. */
  static async update(
    id: string,
    input: UpdateResourceInput,
    context?: AuditContext,
  ): Promise<Result<ResourceDetail>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select()
        .from(resources)
        .where(eq(resources.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Resource ${id} not found`);
      }

      if (input.name && input.name !== existing.name) {
        const [dup] = await db
          .select({ id: resources.id })
          .from(resources)
          .where(eq(resources.name, input.name));

        if (dup) {
          throw new ServiceError('ALREADY_EXISTS', `Resource "${input.name}" already exists`);
        }
      }

      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updates['name'] = input.name;
      if (input.description !== undefined) updates['description'] = input.description;
      if (input.mimeType !== undefined) updates['mimeType'] = input.mimeType;
      if (input.content !== undefined) {
        updates['content'] = input.content;
        updates['sizeBytes'] = Buffer.byteLength(input.content, 'utf-8');
      }

      const [row] = await db
        .update(resources)
        .set(updates)
        .where(eq(resources.id, id))
        .returning();

      emitEvent({
        level: 'INFO', name: 'RESOURCE_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'update', resourceId: id },
      });

      return {
        id: row!.id,
        name: row!.name,
        description: row!.description,
        mimeType: row!.mimeType,
        sizeBytes: row!.sizeBytes,
        content: row!.content,
        createdAt: row!.createdAt,
        updatedAt: row!.updatedAt,
      };
    });
  }

  /** Delete a resource. */
  static async delete(id: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: resources.id })
        .from(resources)
        .where(eq(resources.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Resource ${id} not found`);
      }

      await db
        .delete(resources)
        .where(eq(resources.id, id));

      emitEvent({
        level: 'INFO', name: 'RESOURCE_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'delete', resourceId: id },
      });
    });
  }
}
