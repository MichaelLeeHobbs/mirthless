// ===========================================
// Configuration Map Service
// ===========================================
// Business logic for categorized configuration map CRUD.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, asc } from 'drizzle-orm';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { configuration } from '../db/schema/index.js';

// ----- Response Types -----

export interface ConfigMapEntry {
  readonly category: string;
  readonly name: string;
  readonly value: string | null;
}

// ----- Service -----

export class ConfigMapService {
  /** List all entries, optionally filtered by category. */
  static async list(query?: { readonly category?: string }): Promise<Result<readonly ConfigMapEntry[]>> {
    return tryCatch(async () => {
      const q = db.select().from(configuration);

      const rows = query?.category !== undefined
        ? await q.where(eq(configuration.category, query.category)).orderBy(asc(configuration.category), asc(configuration.name))
        : await q.orderBy(asc(configuration.category), asc(configuration.name));

      return rows.map((r) => ({
        category: r.category,
        name: r.name,
        value: r.value,
      }));
    });
  }

  /** Get a single entry by composite key. */
  static async getByKey(category: string, name: string): Promise<Result<ConfigMapEntry>> {
    return tryCatch(async () => {
      const [row] = await db
        .select()
        .from(configuration)
        .where(and(
          eq(configuration.category, category),
          eq(configuration.name, name),
        ));

      if (!row) {
        throw new ServiceError('NOT_FOUND', `Config entry "${category}/${name}" not found`);
      }

      return {
        category: row.category,
        name: row.name,
        value: row.value,
      };
    });
  }

  /** Create or update an entry by composite key. */
  static async upsert(
    category: string,
    name: string,
    value: string,
    context?: AuditContext,
  ): Promise<Result<ConfigMapEntry>> {
    return tryCatch(async () => {
      const [row] = await db
        .insert(configuration)
        .values({ category, name, value })
        .onConflictDoUpdate({
          target: [configuration.category, configuration.name],
          set: { value },
        })
        .returning();

      emitEvent({
        level: 'INFO', name: 'CONFIG_MAP_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'upsert', category, configName: name },
      });

      return {
        category: row!.category,
        name: row!.name,
        value: row!.value,
      };
    });
  }

  /** Bulk create/update multiple entries in a transaction. */
  static async bulkUpsert(
    entries: ReadonlyArray<{ readonly category: string; readonly name: string; readonly value: string }>,
    context?: AuditContext,
  ): Promise<Result<readonly ConfigMapEntry[]>> {
    return tryCatch(async () => {
      const results: ConfigMapEntry[] = [];

      await db.transaction(async (tx) => {
        for (const entry of entries) {
          const [row] = await tx
            .insert(configuration)
            .values({ category: entry.category, name: entry.name, value: entry.value })
            .onConflictDoUpdate({
              target: [configuration.category, configuration.name],
              set: { value: entry.value },
            })
            .returning();

          results.push({
            category: row!.category,
            name: row!.name,
            value: row!.value,
          });
        }
      });

      emitEvent({
        level: 'INFO', name: 'CONFIG_MAP_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'bulkUpsert', count: entries.length },
      });

      return results;
    });
  }

  /** Delete a single entry by composite key. */
  static async delete(
    category: string,
    name: string,
    context?: AuditContext,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ category: configuration.category })
        .from(configuration)
        .where(and(
          eq(configuration.category, category),
          eq(configuration.name, name),
        ));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Config entry "${category}/${name}" not found`);
      }

      await db
        .delete(configuration)
        .where(and(
          eq(configuration.category, category),
          eq(configuration.name, name),
        ));

      emitEvent({
        level: 'INFO', name: 'CONFIG_MAP_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'delete', category, configName: name },
      });
    });
  }
}
