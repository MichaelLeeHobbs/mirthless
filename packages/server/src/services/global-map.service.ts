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
  /** False: `value` is plain text. True: a script stored a non-text value as JSON. */
  readonly isJson: boolean;
  readonly updatedAt: Date;
}

/** An edit made outside the engine, which running channels need to see. */
export type GlobalMapChange =
  | { readonly type: 'set'; readonly row: { readonly key: string; readonly value: string | null; readonly isJson: boolean } }
  | { readonly type: 'delete'; readonly key: string }
  | { readonly type: 'clear' };

let changeListener: ((change: GlobalMapChange) => void) | null = null;

function notify(change: GlobalMapChange): void {
  if (changeListener) changeListener(change);
}

// ----- Service -----

export class GlobalMapService {
  /** Register the engine's listener for edits made through the API or a restore. */
  static onChange(listener: (change: GlobalMapChange) => void): void {
    changeListener = listener;
  }

  /** Save a value the engine's scripts changed. No audit event: this runs on every flush. */
  static async persist(key: string, value: string, isJson: boolean): Promise<Result<void>> {
    return tryCatch(async () => {
      const now = new Date();
      await db
        .insert(globalMapEntries)
        .values({ key, value, isJson, updatedAt: now })
        .onConflictDoUpdate({
          target: globalMapEntries.key,
          set: { value, isJson, updatedAt: now },
        });
    });
  }

  /** Remove a key a script deleted. A key that is already gone is not an error. */
  static async persistRemoval(key: string): Promise<Result<void>> {
    return tryCatch(async () => {
      await db.delete(globalMapEntries).where(eq(globalMapEntries.key, key));
    });
  }

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
        isJson: r.isJson,
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
        isJson: row.isJson,
        updatedAt: row.updatedAt,
      };
    });
  }

  /**
   * Create or update an entry by key. The value is plain text unless `isJson`
   * is set, which only a backup restore does.
   */
  static async upsert(
    key: string,
    value: string,
    context?: AuditContext,
    isJson = false,
  ): Promise<Result<GlobalMapEntry>> {
    return tryCatch(async () => {
      const now = new Date();
      const [row] = await db
        .insert(globalMapEntries)
        .values({ key, value, isJson, updatedAt: now })
        .onConflictDoUpdate({
          target: globalMapEntries.key,
          set: { value, isJson, updatedAt: now },
        })
        .returning();

      notify({ type: 'set', row: { key, value, isJson } });

      emitEvent({
        level: 'INFO', name: 'GLOBAL_MAP_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'upsert', key },
      });

      return {
        key: row!.key,
        value: row!.value,
        isJson: row!.isJson,
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

      notify({ type: 'delete', key });

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

      notify({ type: 'clear' });

      emitEvent({
        level: 'INFO', name: 'GLOBAL_MAP_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'clear' },
      });
    });
  }
}
