// ===========================================
// Settings Service
// ===========================================
// Business logic for system settings CRUD.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq } from 'drizzle-orm';
import type { UpsertSettingInput } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { systemSettings } from '../db/schema/index.js';

// ----- Response Types -----

export interface SettingDetail {
  readonly id: string;
  readonly key: string;
  readonly value: string | null;
  readonly type: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ----- Helpers -----

function toDetail(row: typeof systemSettings.$inferSelect): SettingDetail {
  return {
    id: row.id,
    key: row.key,
    value: row.value ?? null,
    type: row.type,
    description: row.description ?? null,
    category: row.category ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ----- Service -----

export class SettingsService {
  /** List all settings, optionally filtered by category. */
  static async list(query?: { readonly category?: string }): Promise<Result<readonly SettingDetail[]>> {
    return tryCatch(async () => {
      const q = db.select().from(systemSettings);

      const rows = query?.category !== undefined
        ? await q.where(eq(systemSettings.category, query.category))
        : await q;

      return rows.map(toDetail);
    });
  }

  /** Get a single setting by its unique key. */
  static async getByKey(key: string): Promise<Result<SettingDetail>> {
    return tryCatch(async () => {
      const [row] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, key));

      if (!row) {
        throw new ServiceError('NOT_FOUND', `Setting "${key}" not found`);
      }

      return toDetail(row);
    });
  }

  /** Create or update a setting by key. Uses Drizzle onConflictDoUpdate. */
  static async upsert(input: UpsertSettingInput, context?: AuditContext): Promise<Result<SettingDetail>> {
    return tryCatch(async () => {
      const [row] = await db
        .insert(systemSettings)
        .values({
          key: input.key,
          value: input.value,
          type: input.type,
          description: input.description,
          category: input.category,
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: {
            value: input.value,
            type: input.type,
            description: input.description,
            category: input.category,
            updatedAt: new Date(),
          },
        })
        .returning();

      const detail = toDetail(row!);

      emitEvent({
        level: 'INFO', name: 'SETTINGS_CHANGED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { key: input.key },
      });

      return detail;
    });
  }

  /** Bulk create/update multiple settings in a transaction. */
  static async bulkUpsert(inputs: readonly UpsertSettingInput[], context?: AuditContext): Promise<Result<readonly SettingDetail[]>> {
    return tryCatch(async () => {
      const results: SettingDetail[] = [];

      await db.transaction(async (tx) => {
        for (const input of inputs) {
          const [row] = await tx
            .insert(systemSettings)
            .values({
              key: input.key,
              value: input.value,
              type: input.type,
              description: input.description,
              category: input.category,
            })
            .onConflictDoUpdate({
              target: systemSettings.key,
              set: {
                value: input.value,
                type: input.type,
                description: input.description,
                category: input.category,
                updatedAt: new Date(),
              },
            })
            .returning();

          results.push(toDetail(row!));
        }
      });

      emitEvent({
        level: 'INFO', name: 'SETTINGS_CHANGED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { keys: inputs.map((i) => i.key) },
      });

      return results;
    });
  }

  /** Delete a setting by key. */
  static async delete(key: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: systemSettings.id })
        .from(systemSettings)
        .where(eq(systemSettings.key, key));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Setting "${key}" not found`);
      }

      await db.delete(systemSettings).where(eq(systemSettings.key, key));

      emitEvent({
        level: 'INFO', name: 'SETTINGS_CHANGED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { key, action: 'delete' },
      });
    });
  }
}
