import { tryCatch, type Result } from 'stderr-lib';
import { and, eq, asc, sql } from 'drizzle-orm';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { userPreferences } from '../db/schema/index.js';

export interface UserPreferenceEntry {
  readonly key: string;
  readonly value: string | null;
}

export class UserPreferenceService {
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

  /**
   * A key repeated in one batch takes its last value: Postgres rejects an
   * INSERT ... ON CONFLICT that touches the same row twice.
   */
  static async bulkUpsert(
    userId: string,
    entries: readonly { readonly key: string; readonly value: string | null }[],
  ): Promise<Result<readonly UserPreferenceEntry[]>> {
    return tryCatch(async () => {
      const latest = new Map<string, string | null>();
      for (const e of entries) latest.set(e.key, e.value);
      if (latest.size === 0) return [];

      const rows = await db
        .insert(userPreferences)
        .values([...latest].map(([key, value]) => ({ userId, key, value })))
        .onConflictDoUpdate({
          target: [userPreferences.userId, userPreferences.key],
          set: { value: sql`excluded.value` },
        })
        .returning();

      return rows.map((r) => ({ key: r.key, value: r.value }));
    });
  }
}
