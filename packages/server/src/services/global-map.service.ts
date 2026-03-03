// ===========================================
// Global Map Service
// ===========================================
// Business logic for global map key-value store CRUD.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, asc } from 'drizzle-orm';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { globalMapEntries } from '../db/schema/index.js';

// ----- Response Types -----

export interface GlobalMapEntry {
  readonly key: string;
  readonly value: string | null;
  readonly updatedAt: Date;
}

// ----- Service -----

export class GlobalMapService {
  /** List all global map entries sorted by key. */
  static async list(): Promise<Result<readonly GlobalMapEntry[]>> {
    return tryCatch(async () => {
      const rows = await db
        .select()
        .from(globalMapEntries)
        .orderBy(asc(globalMapEntries.key));

      return rows.map((r) => ({
        key: r.key,
        value: r.value,
        updatedAt: r.updatedAt,
      }));
    });
  }

  /** Get a single entry by key. */
  static async getByKey(key: string): Promise<Result<GlobalMapEntry>> {
    return tryCatch(async () => {
      const [row] = await db
        .select()
        .from(globalMapEntries)
        .where(eq(globalMapEntries.key, key));

      if (!row) {
        throw new ServiceError('NOT_FOUND', `Global map entry "${key}" not found`);
      }

      return {
        key: row.key,
        value: row.value,
        updatedAt: row.updatedAt,
      };
    });
  }

  /** Create or update an entry by key. */
  static async upsert(
    key: string,
    value: string,
    context?: AuditContext,
  ): Promise<Result<GlobalMapEntry>> {
    return tryCatch(async () => {
      const now = new Date();
      const [row] = await db
        .insert(globalMapEntries)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({
          target: globalMapEntries.key,
          set: { value, updatedAt: now },
        })
        .returning();

      emitEvent({
        level: 'INFO', name: 'GLOBAL_MAP_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'upsert', key },
      });

      return {
        key: row!.key,
        value: row!.value,
        updatedAt: row!.updatedAt,
      };
    });
  }

  /** Delete a single entry by key. */
  static async delete(key: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ key: globalMapEntries.key })
        .from(globalMapEntries)
        .where(eq(globalMapEntries.key, key));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Global map entry "${key}" not found`);
      }

      await db
        .delete(globalMapEntries)
        .where(eq(globalMapEntries.key, key));

      emitEvent({
        level: 'INFO', name: 'GLOBAL_MAP_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'delete', key },
      });
    });
  }

  /** Clear all entries. */
  static async clear(context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      await db.delete(globalMapEntries);

      emitEvent({
        level: 'INFO', name: 'GLOBAL_MAP_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'clear' },
      });
    });
  }
}
