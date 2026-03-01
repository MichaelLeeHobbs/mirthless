// ===========================================
// Code Template Service
// ===========================================
// Business logic for code template library + template CRUD.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, count, asc } from 'drizzle-orm';
import type {
  CreateCodeTemplateLibraryInput,
  UpdateCodeTemplateLibraryInput,
  CreateCodeTemplateInput,
  UpdateCodeTemplateInput,
} from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { codeTemplateLibraries, codeTemplates } from '../db/schema/index.js';

// ----- Response Types -----

export interface LibrarySummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly revision: number;
  readonly templateCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TemplateDetail {
  readonly id: string;
  readonly libraryId: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: string;
  readonly code: string;
  readonly contexts: ReadonlyArray<string>;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ----- Service -----

export class CodeTemplateService {
  // ===== Libraries =====

  /** List all libraries with template counts. */
  static async listLibraries(): Promise<Result<readonly LibrarySummary[]>> {
    return tryCatch(async () => {
      const libs = await db
        .select()
        .from(codeTemplateLibraries)
        .orderBy(asc(codeTemplateLibraries.name));

      const summaries: LibrarySummary[] = [];

      for (const lib of libs) {
        const [countRow] = await db
          .select({ value: count() })
          .from(codeTemplates)
          .where(eq(codeTemplates.libraryId, lib.id));

        summaries.push({
          id: lib.id,
          name: lib.name,
          description: lib.description,
          revision: lib.revision,
          templateCount: countRow?.value ?? 0,
          createdAt: lib.createdAt,
          updatedAt: lib.updatedAt,
        });
      }

      return summaries;
    });
  }

  /** Create a new library. */
  static async createLibrary(
    input: CreateCodeTemplateLibraryInput,
    context?: AuditContext,
  ): Promise<Result<LibrarySummary>> {
    return tryCatch(async () => {
      // Check for duplicate name
      const [existing] = await db
        .select({ id: codeTemplateLibraries.id })
        .from(codeTemplateLibraries)
        .where(eq(codeTemplateLibraries.name, input.name));

      if (existing) {
        throw new ServiceError('ALREADY_EXISTS', `Library "${input.name}" already exists`);
      }

      const [row] = await db
        .insert(codeTemplateLibraries)
        .values({
          name: input.name,
          description: input.description,
        })
        .returning();

      emitEvent({
        level: 'INFO', name: 'CODE_TEMPLATE_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'createLibrary', libraryName: input.name },
      });

      return {
        id: row!.id,
        name: row!.name,
        description: row!.description,
        revision: row!.revision,
        templateCount: 0,
        createdAt: row!.createdAt,
        updatedAt: row!.updatedAt,
      };
    });
  }

  /** Update a library (optimistic locking). */
  static async updateLibrary(
    id: string,
    input: UpdateCodeTemplateLibraryInput,
    context?: AuditContext,
  ): Promise<Result<LibrarySummary>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select()
        .from(codeTemplateLibraries)
        .where(eq(codeTemplateLibraries.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Library ${id} not found`);
      }

      if (existing.revision !== input.revision) {
        throw new ServiceError('CONFLICT', 'Library has been modified by another user');
      }

      // Check duplicate name if changing
      if (input.name && input.name !== existing.name) {
        const [dup] = await db
          .select({ id: codeTemplateLibraries.id })
          .from(codeTemplateLibraries)
          .where(eq(codeTemplateLibraries.name, input.name));

        if (dup) {
          throw new ServiceError('ALREADY_EXISTS', `Library "${input.name}" already exists`);
        }
      }

      const updates: Record<string, unknown> = {
        revision: existing.revision + 1,
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updates['name'] = input.name;
      if (input.description !== undefined) updates['description'] = input.description;

      const [row] = await db
        .update(codeTemplateLibraries)
        .set(updates)
        .where(eq(codeTemplateLibraries.id, id))
        .returning();

      const [countRow] = await db
        .select({ value: count() })
        .from(codeTemplates)
        .where(eq(codeTemplates.libraryId, id));

      emitEvent({
        level: 'INFO', name: 'CODE_TEMPLATE_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'updateLibrary', libraryId: id },
      });

      return {
        id: row!.id,
        name: row!.name,
        description: row!.description,
        revision: row!.revision,
        templateCount: countRow?.value ?? 0,
        createdAt: row!.createdAt,
        updatedAt: row!.updatedAt,
      };
    });
  }

  /** Delete a library (cascades to templates). */
  static async deleteLibrary(id: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: codeTemplateLibraries.id })
        .from(codeTemplateLibraries)
        .where(eq(codeTemplateLibraries.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Library ${id} not found`);
      }

      await db
        .delete(codeTemplateLibraries)
        .where(eq(codeTemplateLibraries.id, id));

      emitEvent({
        level: 'INFO', name: 'CODE_TEMPLATE_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'deleteLibrary', libraryId: id },
      });
    });
  }

  // ===== Templates =====

  /** List templates, optionally filtered by library. */
  static async listTemplates(
    libraryId?: string,
  ): Promise<Result<readonly TemplateDetail[]>> {
    return tryCatch(async () => {
      let query = db
        .select()
        .from(codeTemplates)
        .orderBy(asc(codeTemplates.name));

      if (libraryId) {
        query = query.where(eq(codeTemplates.libraryId, libraryId)) as typeof query;
      }

      const rows = await query;

      return rows.map((r) => ({
        id: r.id,
        libraryId: r.libraryId,
        name: r.name,
        description: r.description,
        type: r.type,
        code: r.code,
        contexts: r.contexts,
        revision: r.revision,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    });
  }

  /** Get a single template by ID. */
  static async getTemplate(id: string): Promise<Result<TemplateDetail>> {
    return tryCatch(async () => {
      const [row] = await db
        .select()
        .from(codeTemplates)
        .where(eq(codeTemplates.id, id));

      if (!row) {
        throw new ServiceError('NOT_FOUND', `Template ${id} not found`);
      }

      return {
        id: row.id,
        libraryId: row.libraryId,
        name: row.name,
        description: row.description,
        type: row.type,
        code: row.code,
        contexts: row.contexts,
        revision: row.revision,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  /** Create a new template. */
  static async createTemplate(
    input: CreateCodeTemplateInput,
    context?: AuditContext,
  ): Promise<Result<TemplateDetail>> {
    return tryCatch(async () => {
      // Verify library exists
      const [lib] = await db
        .select({ id: codeTemplateLibraries.id })
        .from(codeTemplateLibraries)
        .where(eq(codeTemplateLibraries.id, input.libraryId));

      if (!lib) {
        throw new ServiceError('NOT_FOUND', `Library ${input.libraryId} not found`);
      }

      const [row] = await db
        .insert(codeTemplates)
        .values({
          libraryId: input.libraryId,
          name: input.name,
          description: input.description,
          type: input.type,
          code: input.code,
          contexts: input.contexts,
        })
        .returning();

      emitEvent({
        level: 'INFO', name: 'CODE_TEMPLATE_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'createTemplate', templateName: input.name },
      });

      return {
        id: row!.id,
        libraryId: row!.libraryId,
        name: row!.name,
        description: row!.description,
        type: row!.type,
        code: row!.code,
        contexts: row!.contexts,
        revision: row!.revision,
        createdAt: row!.createdAt,
        updatedAt: row!.updatedAt,
      };
    });
  }

  /** Update a template (optimistic locking). */
  static async updateTemplate(
    id: string,
    input: UpdateCodeTemplateInput,
    context?: AuditContext,
  ): Promise<Result<TemplateDetail>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select()
        .from(codeTemplates)
        .where(eq(codeTemplates.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Template ${id} not found`);
      }

      if (existing.revision !== input.revision) {
        throw new ServiceError('CONFLICT', 'Template has been modified by another user');
      }

      const updates: Record<string, unknown> = {
        revision: existing.revision + 1,
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updates['name'] = input.name;
      if (input.description !== undefined) updates['description'] = input.description;
      if (input.type !== undefined) updates['type'] = input.type;
      if (input.code !== undefined) updates['code'] = input.code;
      if (input.contexts !== undefined) updates['contexts'] = input.contexts;

      const [row] = await db
        .update(codeTemplates)
        .set(updates)
        .where(eq(codeTemplates.id, id))
        .returning();

      emitEvent({
        level: 'INFO', name: 'CODE_TEMPLATE_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'updateTemplate', templateId: id },
      });

      return {
        id: row!.id,
        libraryId: row!.libraryId,
        name: row!.name,
        description: row!.description,
        type: row!.type,
        code: row!.code,
        contexts: row!.contexts,
        revision: row!.revision,
        createdAt: row!.createdAt,
        updatedAt: row!.updatedAt,
      };
    });
  }

  /** Delete a template. */
  static async deleteTemplate(id: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: codeTemplates.id })
        .from(codeTemplates)
        .where(eq(codeTemplates.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Template ${id} not found`);
      }

      await db
        .delete(codeTemplates)
        .where(eq(codeTemplates.id, id));

      emitEvent({
        level: 'INFO', name: 'CODE_TEMPLATE_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'deleteTemplate', templateId: id },
      });
    });
  }
}
