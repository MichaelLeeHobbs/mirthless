import { tryCatch, type Result } from 'stderr-lib';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { UpsertSettingInput } from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { redactSettingValue } from '../lib/secret-redaction.js';
import { db } from '../lib/db.js';
import { systemSettings } from '../db/schema/index.js';

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

/** Secrets masked: settings:read must never see them. */
function toReadDetail(row: typeof systemSettings.$inferSelect): SettingDetail {
  const detail = toDetail(row);
  return { ...detail, value: redactSettingValue(detail.key, detail.type, detail.value) };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const SMTP_HOST = 'smtp.host';
const SMTP_PASSWORD = 'smtp.auth_pass';

/** True when there was one. */
async function clearPassword(tx: Tx): Promise<boolean> {
  const cleared = await tx.update(systemSettings).set({ value: '', updatedAt: new Date() })
    .where(and(eq(systemSettings.key, SMTP_PASSWORD), ne(systemSettings.value, '')))
    .returning({ id: systemSettings.id });
  return cleared.length > 0;
}

/**
 * The password was typed for the host that was there: kept, a settings writer who never sees it
 * could have it sent to a server of theirs (D-332). A save that sets the password too keeps that one.
 */
async function clearPasswordOfChangedHost(tx: Tx, inputs: readonly UpsertSettingInput[]): Promise<boolean> {
  const hosts = inputs.filter((i) => i.key === SMTP_HOST);
  if (hosts.length === 0 || inputs.some((i) => i.key === SMTP_PASSWORD)) return false;
  const [stored] = await tx.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, SMTP_HOST)).for('update');
  if (hosts.every((h) => (h.value ?? '') === (stored?.value ?? ''))) return false;
  return clearPassword(tx);
}

async function upsertRow(tx: Tx, input: UpsertSettingInput): Promise<SettingDetail> {
  const { key, value, type, description, category } = input;
  const [row] = await tx
    .insert(systemSettings)
    .values({ key, value, type, description, category })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, type, description, category, updatedAt: new Date() } })
    .returning();
  return toDetail(row!);
}

function clearedAttribute(cleared: boolean): { readonly cleared?: string } {
  return cleared ? { cleared: SMTP_PASSWORD } : {};
}

function recordChange(attributes: Record<string, unknown>, context: AuditContext | undefined): void {
  emitEvent({
    level: 'INFO', name: 'SETTINGS_CHANGED', outcome: 'SUCCESS',
    userId: context?.userId ?? null, channelId: null,
    serverId: null, ipAddress: context?.ipAddress ?? null,
    attributes,
  });
}

export class SettingsService {
  static async list(query?: { readonly category?: string }): Promise<Result<readonly SettingDetail[]>> {
    return tryCatch(async () => {
      const q = db.select().from(systemSettings);

      const rows = query?.category !== undefined
        ? await q.where(eq(systemSettings.category, query.category))
        : await q;

      return rows.map(toReadDetail);
    });
  }

  static async getByKey(key: string): Promise<Result<SettingDetail>> {
    return tryCatch(async () => {
      const [row] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, key));

      if (!row) {
        throw new ServiceError('NOT_FOUND', `Setting "${key}" not found`);
      }

      return toReadDetail(row);
    });
  }

  /** Unmasked, so for the server's own use and never in a response. Read at one moment; a key not set is left out. */
  static async getStoredValues(keys: readonly string[]): Promise<Result<ReadonlyMap<string, string>>> {
    return tryCatch(async () => {
      const rows = await db
        .select()
        .from(systemSettings)
        .where(inArray(systemSettings.key, [...keys]));
      return new Map(rows.flatMap((r) => (r.value === null ? [] : [[r.key, r.value] as const])));
    });
  }

  static async upsert(input: UpsertSettingInput, context?: AuditContext): Promise<Result<SettingDetail>> {
    return tryCatch(async () => {
      const { detail, cleared } = await db.transaction(async (tx) => ({
        cleared: await clearPasswordOfChangedHost(tx, [input]), detail: await upsertRow(tx, input),
      }));
      recordChange({ key: input.key, ...clearedAttribute(cleared) }, context);
      return detail;
    });
  }

  static async bulkUpsert(inputs: readonly UpsertSettingInput[], context?: AuditContext): Promise<Result<readonly SettingDetail[]>> {
    return tryCatch(async () => {
      const results: SettingDetail[] = [];
      const cleared = await db.transaction(async (tx) => {
        const clears = await clearPasswordOfChangedHost(tx, inputs);
        for (const input of inputs) results.push(await upsertRow(tx, input));
        return clears;
      });
      recordChange({ keys: inputs.map((i) => i.key), ...clearedAttribute(cleared) }, context);
      return results;
    });
  }

  static async delete(key: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: systemSettings.id })
        .from(systemSettings)
        .where(eq(systemSettings.key, key));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Setting "${key}" not found`);
      }

      const cleared = await db.transaction(async (tx) => {
        const clears = key === SMTP_HOST && await clearPassword(tx);
        await tx.delete(systemSettings).where(eq(systemSettings.key, key));
        return clears;
      });
      recordChange({ key, action: 'delete', ...clearedAttribute(cleared) }, context);
    });
  }
}
