// ===========================================
// User Preference Service
// ===========================================
// Business logic for per-user preferences key-value store.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { and, eq, asc, sql } from 'drizzle-orm';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { userPreferences } from '../db/schema/index.js';

// ----- Response Types -----

export interface UserPreferenceEntry {
  readonly key: string;
  readonly value: string | null;
}

// ----- Service -----

export class UserPreferenceService {
  /** List all preferences for a user, sorted by key. */
  static async list(userId: string): Promise<Result<readonly UserPreferenceEntry[]>> {
    return tryCatch(async () => {
      const rows = await db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .orderBy(asc(userPreferences.key));

      return rows.map((r) => ({
        key: r.key,
        value: r.value,
      }));
    });
  }

  /** Get a single preference by key. */
  static async getByKey(userId: string, key: string): Promise<Result<UserPreferenceEntry>> {
    return tryCatch(async () => {
      const [row] = await db
        .select()
        .from(userPreferences)
        .where(
          and(
            eq(userPreferences.userId, userId),
            eq(userPreferences.key, key),
          ),
        );

      if (!row) {
        throw new ServiceError('NOT_FOUND', `Preference "${key}" not found`);
      }

      return { key: row.key, value: row.value };
    });
  }

  /** Create or update a preference. */
  static async upsert(
    userId: string,
    key: string,
    value: string | null,
  ): Promise<Result<UserPreferenceEntry>> {
    return tryCatch(async () => {
      const [row] = await db
        .insert(userPreferences)
        .values({ userId, key, value })
        .onConflictDoUpdate({
          target: [userPreferences.userId, userPreferences.key],
          set: { value },
        })
        .returning();

      return { key: row!.key, value: row!.value };
    });
  }

  /** Delete a preference by key. */
  static async delete(userId: string, key: string): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ key: userPreferences.key })
        .from(userPreferences)
        .where(
          and(
            eq(userPreferences.userId, userId),
            eq(userPreferences.key, key),
          ),
        );

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Preference "${key}" not found`);
      }

      await db
        .delete(userPreferences)
        .where(
          and(
            eq(userPreferences.userId, userId),
            eq(userPreferences.key, key),
          ),
        );
    });
  }

  /** Bulk upsert multiple preferences. */
  static async bulkUpsert(
    userId: string,
    entries: readonly { readonly key: string; readonly value: string | null }[],
  ): Promise<Result<readonly UserPreferenceEntry[]>> {
    return tryCatch(async () => {
      const rows = await db
        .insert(userPreferences)
        .values(entries.map((e) => ({ userId, key: e.key, value: e.value })))
        .onConflictDoUpdate({
          target: [userPreferences.userId, userPreferences.key],
          set: { value: sql`excluded.value` },
        })
        .returning();

      return rows.map((r) => ({ key: r.key, value: r.value }));
    });
  }
}
