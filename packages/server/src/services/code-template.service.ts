import { assertScriptCompiles } from './script-validation.service.js';
import { tryCatch, type Result } from 'stderr-lib';
import { and, eq, count, asc, or, isNull, sql } from 'drizzle-orm';
import {
  ALL_CHANNELS,
  PERMISSIONS,
  type CreateCodeTemplateLibraryInput,
  type UpdateCodeTemplateLibraryInput,
  type CreateCodeTemplateInput,
  type UpdateCodeTemplateInput,
  type FoldedGrants,
  type Permission,
} from '@galvanigraph/core-models';
import { grantedChannels, holdsOnEveryChannel, linksInScope, type ChannelScope } from '../lib/channel-scope.js';
import { queryUserStanding } from '../lib/principal.js';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { codeTemplateLibraries, codeTemplates, type CodeTemplate } from '../db/schema/index.js';

export interface LibrarySummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly revision: number;
  readonly templateCount: number;
  /** null: every channel. */
  readonly channelIds: readonly string[] | null;
  /** Links outside the reader's code_templates:read scope, left out of `channelIds`. */
  readonly outsideScopeCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TemplateDetail {
  readonly id: string;
  readonly libraryId: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: string;
  readonly language: string;
  readonly code: string;
  readonly contexts: ReadonlyArray<string>;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function toTemplateDetail(r: CodeTemplate): TemplateDetail {
  return {
    id: r.id,
    libraryId: r.libraryId,
    name: r.name,
    description: r.description,
    type: r.type,
    language: r.language,
    code: r.code,
    contexts: r.contexts,
    revision: r.revision,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// A library's templates are compiled into the channels it links to, so a
// library or template write needs the permission on every linked channel (D-310).

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, 'select'>;

async function writerGrants(reader: Reader, context?: AuditContext): Promise<FoldedGrants> {
  const standing = context?.userId ? await queryUserStanding(reader, context.userId) : null;
  return standing?.enabled === true ? standing.grants : new Map();
}

async function defaultLinks(grants: FoldedGrants): Promise<string[] | null> {
  const scope = await grantedChannels(grants, PERMISSIONS.CODE_TEMPLATES_WRITE);
  if (scope === ALL_CHANNELS) return null;
  if (scope.length === 0) throw new ServiceError('INVALID_INPUT', 'Your groups hold no channels yet, so a new library has nothing to link to; add a channel first');
  return [...scope];
}

async function assertLinksHeld(reader: Reader, grants: FoldedGrants, permission: Permission, links: readonly string[] | null): Promise<void> {
  if (await holdsOnEveryChannel(grants, permission, links, reader)) return;
  const reach = links === null ? 'every channel' : links.length === 0 ? 'no channel, which only someone holding it on every channel may set' : 'channels outside your scope';
  throw new ServiceError('FORBIDDEN', `This needs ${permission} on every channel the library links to, and it links to ${reach}`);
}

async function lockLibrary(tx: Tx, id: string, mode: 'update' | 'share'): Promise<typeof codeTemplateLibraries.$inferSelect> {
  const [row] = await tx.select().from(codeTemplateLibraries).where(eq(codeTemplateLibraries.id, id)).for(mode);
  if (!row) throw new ServiceError('NOT_FOUND', `Library ${id} not found`);
  return row;
}

/** FOR SHARE keeps the links from changing until the write commits. */
async function assertLibraryWritable(tx: Tx, libraryId: string, permission: Permission, context?: AuditContext): Promise<void> {
  const library = await lockLibrary(tx, libraryId, 'share');
  await assertLinksHeld(tx, await writerGrants(tx, context), permission, library.channelIds ?? null);
}

async function findTemplate(reader: Reader, id: string): Promise<CodeTemplate> {
  const [row] = await reader.select().from(codeTemplates).where(eq(codeTemplates.id, id));
  if (!row) throw new ServiceError('NOT_FOUND', `Template ${id} not found`);
  return row;
}

export class CodeTemplateService {
  /** For an import, which must check all its libraries before writing any. */
  static async assertCanWriteLinks(linkSets: ReadonlyArray<readonly string[] | null>, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const grants = await writerGrants(db, context);
      for (const links of linkSets) await assertLinksHeld(db, grants, PERMISSIONS.CODE_TEMPLATES_WRITE, links);
    });
  }

  /** Links outside `scope` (the reader's code_templates:read channels) show as a count only. */
  static async listLibraries(scope: ChannelScope = ALL_CHANNELS): Promise<Result<readonly LibrarySummary[]>> {
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

        const links = lib.channelIds ? linksInScope(lib.channelIds, scope) : null;
        summaries.push({
          id: lib.id,
          name: lib.name,
          description: lib.description,
          revision: lib.revision,
          templateCount: countRow?.value ?? 0,
          channelIds: links?.shown ?? null,
          outsideScopeCount: links?.outsideScopeCount ?? 0,
          createdAt: lib.createdAt,
          updatedAt: lib.updatedAt,
        });
      }

      return summaries;
    });
  }

  static async createLibrary(
    input: CreateCodeTemplateLibraryInput,
    context?: AuditContext,
  ): Promise<Result<LibrarySummary>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: codeTemplateLibraries.id })
        .from(codeTemplateLibraries)
        .where(eq(codeTemplateLibraries.name, input.name));

      if (existing) {
        throw new ServiceError('ALREADY_EXISTS', `Library "${input.name}" already exists`);
      }

      const grants = await writerGrants(db, context);
      const channelIds = input.channelIds !== undefined ? input.channelIds : await defaultLinks(grants);
      await assertLinksHeld(db, grants, PERMISSIONS.CODE_TEMPLATES_WRITE, channelIds);

      const [row] = await db
        .insert(codeTemplateLibraries)
        .values({
          name: input.name,
          description: input.description,
          channelIds,
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
        channelIds: row!.channelIds ?? null,
        outsideScopeCount: 0,
        createdAt: row!.createdAt,
        updatedAt: row!.updatedAt,
      };
    });
  }

  static async updateLibrary(
    id: string,
    input: UpdateCodeTemplateLibraryInput,
    context?: AuditContext,
  ): Promise<Result<LibrarySummary>> {
    return tryCatch(async () => {
      const row = await db.transaction(async (tx) => {
        const existing = await lockLibrary(tx, id, 'update');

        if (existing.revision !== input.revision) {
          throw new ServiceError('CONFLICT', 'Library has been modified by another user');
        }

        const grants = await writerGrants(tx, context);
        await assertLinksHeld(tx, grants, PERMISSIONS.CODE_TEMPLATES_WRITE, existing.channelIds ?? null);
        if (input.channelIds !== undefined) await assertLinksHeld(tx, grants, PERMISSIONS.CODE_TEMPLATES_WRITE, input.channelIds);

        if (input.name && input.name !== existing.name) {
          const [dup] = await tx
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
        if (input.channelIds !== undefined) updates['channelIds'] = input.channelIds;

        const [updated] = await tx
          .update(codeTemplateLibraries)
          .set(updates)
          .where(eq(codeTemplateLibraries.id, id))
          .returning();
        return updated!;
      });

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
        id: row.id,
        name: row.name,
        description: row.description,
        revision: row.revision,
        templateCount: countRow?.value ?? 0,
        channelIds: row.channelIds ?? null,
        outsideScopeCount: 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  /** Cascades to its templates. */
  static async deleteLibrary(id: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      await db.transaction(async (tx) => {
        const existing = await lockLibrary(tx, id, 'update');
        await assertLinksHeld(tx, await writerGrants(tx, context), PERMISSIONS.CODE_TEMPLATES_DELETE, existing.channelIds ?? null);
        await tx
          .delete(codeTemplateLibraries)
          .where(eq(codeTemplateLibraries.id, id));
      });

      emitEvent({
        level: 'INFO', name: 'CODE_TEMPLATE_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'deleteLibrary', libraryId: id },
      });
    });
  }

  static async listTemplatesForChannel(channelId: string): Promise<Result<readonly TemplateDetail[]>> {
    return tryCatch(async () => {
      const rows = await db
        .select({ template: codeTemplates })
        .from(codeTemplates)
        .innerJoin(codeTemplateLibraries, eq(codeTemplates.libraryId, codeTemplateLibraries.id))
        .where(or(
          isNull(codeTemplateLibraries.channelIds),
          sql`${codeTemplateLibraries.channelIds} @> ${JSON.stringify([channelId])}::jsonb`,
        ))
        .orderBy(asc(codeTemplates.name));
      return rows.map(({ template }) => toTemplateDetail(template));
    });
  }

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

      return rows.map(toTemplateDetail);
    });
  }

  static async getTemplate(id: string): Promise<Result<TemplateDetail>> {
    return tryCatch(async () => {
      const [row] = await db
        .select()
        .from(codeTemplates)
        .where(eq(codeTemplates.id, id));

      if (!row) {
        throw new ServiceError('NOT_FOUND', `Template ${id} not found`);
      }

      return toTemplateDetail(row);
    });
  }

  static async createTemplate(
    input: CreateCodeTemplateInput,
    context?: AuditContext,
  ): Promise<Result<TemplateDetail>> {
    return tryCatch(async () => {
      // Only FUNCTION templates are compiled into channel scripts.
      if (input.type === 'FUNCTION') await assertScriptCompiles(input.code, `Code template "${input.name}"`);

      const row = await db.transaction(async (tx) => {
        await assertLibraryWritable(tx, input.libraryId, PERMISSIONS.CODE_TEMPLATES_WRITE, context);
        const [inserted] = await tx
          .insert(codeTemplates)
        .values({
          libraryId: input.libraryId,
          name: input.name,
          description: input.description,
          type: input.type,
          language: input.language,
          code: input.code,
          contexts: input.contexts,
        })
        .returning();
        return inserted!;
      });

      emitEvent({
        level: 'INFO', name: 'CODE_TEMPLATE_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'createTemplate', templateName: input.name },
      });

      return toTemplateDetail(row);
    });
  }

  static async updateTemplate(
    id: string,
    input: UpdateCodeTemplateInput,
    context?: AuditContext,
  ): Promise<Result<TemplateDetail>> {
    return tryCatch(async () => {
      const existing = await findTemplate(db, id);
      if (existing.revision !== input.revision) {
        throw new ServiceError('CONFLICT', 'Template has been modified by another user');
      }
      // Compiled before the transaction, so the library lock is not held through a type check.
      if ((input.type ?? existing.type) === 'FUNCTION') {
        await assertScriptCompiles(input.code ?? existing.code, `Code template "${input.name ?? existing.name}"`);
      }

      const row = await db.transaction(async (tx) => {
        await assertLibraryWritable(tx, existing.libraryId, PERMISSIONS.CODE_TEMPLATES_WRITE, context);

        const updates: Record<string, unknown> = {
          revision: existing.revision + 1,
          updatedAt: new Date(),
        };
        if (input.name !== undefined) updates['name'] = input.name;
        if (input.description !== undefined) updates['description'] = input.description;
        if (input.type !== undefined) updates['type'] = input.type;
        if (input.language !== undefined) updates['language'] = input.language;
        if (input.code !== undefined) updates['code'] = input.code;
        if (input.contexts !== undefined) updates['contexts'] = input.contexts;

        const [updated] = await tx
          .update(codeTemplates)
          .set(updates)
          .where(and(eq(codeTemplates.id, id), eq(codeTemplates.revision, input.revision)))
          .returning();
        if (!updated) throw new ServiceError('CONFLICT', 'Template has been modified by another user');
        return updated;
      });

      emitEvent({
        level: 'INFO', name: 'CODE_TEMPLATE_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'updateTemplate', templateId: id },
      });

      return toTemplateDetail(row);
    });
  }

  static async deleteTemplate(id: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      await db.transaction(async (tx) => {
        const existing = await findTemplate(tx, id);
        await assertLibraryWritable(tx, existing.libraryId, PERMISSIONS.CODE_TEMPLATES_DELETE, context);
        await tx
          .delete(codeTemplates)
          .where(eq(codeTemplates.id, id));
      });

      emitEvent({
        level: 'INFO', name: 'CODE_TEMPLATE_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'deleteTemplate', templateId: id },
      });
    });
  }
}
