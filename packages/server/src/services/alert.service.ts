// ===========================================
// Alert Service
// ===========================================
// Business logic for alert CRUD operations.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, count, asc } from 'drizzle-orm';
import type { CreateAlertInput, UpdateAlertInput } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { alerts, alertChannels, alertActions } from '../db/schema/index.js';

// ----- Response Types -----

export interface AlertActionDetail {
  readonly id: string;
  readonly actionType: string;
  readonly recipients: ReadonlyArray<string>;
  readonly properties: Record<string, unknown> | null;
}

export interface AlertSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly triggerType: string;
  readonly revision: number;
  readonly channelCount: number;
  readonly actionCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AlertDetail extends AlertSummary {
  readonly trigger: {
    readonly type: string;
    readonly errorTypes: ReadonlyArray<string>;
    readonly regex: string | null;
  };
  readonly channelIds: ReadonlyArray<string>;
  readonly actions: ReadonlyArray<AlertActionDetail>;
  readonly subjectTemplate: string | null;
  readonly bodyTemplate: string | null;
  readonly reAlertIntervalMs: number | null;
  readonly maxAlerts: number | null;
}

export interface AlertListResult {
  readonly data: readonly AlertSummary[];
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

// ----- Helpers -----

function parseTrigger(
  triggerType: string,
  triggerScript: string | null,
): { readonly type: string; readonly errorTypes: ReadonlyArray<string>; readonly regex: string | null } {
  if (triggerScript) {
    const parsed = JSON.parse(triggerScript) as { errorTypes: string[]; regex: string | null };
    return { type: triggerType, errorTypes: parsed.errorTypes, regex: parsed.regex };
  }
  return { type: triggerType, errorTypes: [], regex: null };
}

async function fetchAlertDetail(alertId: string): Promise<AlertDetail> {
  const [row] = await db
    .select()
    .from(alerts)
    .where(eq(alerts.id, alertId));

  if (!row) {
    throw new ServiceError('NOT_FOUND', `Alert ${alertId} not found`);
  }

  const channelRows = await db
    .select()
    .from(alertChannels)
    .where(eq(alertChannels.alertId, alertId));

  const actionRows = await db
    .select()
    .from(alertActions)
    .where(eq(alertActions.alertId, alertId));

  const trigger = parseTrigger(row.triggerType, row.triggerScript);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    triggerType: row.triggerType,
    revision: row.revision,
    channelCount: channelRows.length,
    actionCount: actionRows.length,
    trigger,
    channelIds: channelRows.map((c) => c.channelId),
    actions: actionRows.map((a) => ({
      id: a.id,
      actionType: a.actionType,
      recipients: a.recipients as ReadonlyArray<string>,
      properties: a.properties,
    })),
    subjectTemplate: row.subjectTemplate,
    bodyTemplate: row.bodyTemplate,
    reAlertIntervalMs: row.reAlertIntervalMs,
    maxAlerts: row.maxAlerts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ----- Service -----

export class AlertService {
  /** List alerts with pagination. */
  static async list(query: {
    readonly page: number;
    readonly pageSize: number;
  }): Promise<Result<AlertListResult>> {
    return tryCatch(async () => {
      const offset = (query.page - 1) * query.pageSize;

      const [totalRow] = await db
        .select({ value: count() })
        .from(alerts);

      const total = totalRow?.value ?? 0;
      const totalPages = Math.ceil(total / query.pageSize);

      const rows = await db
        .select()
        .from(alerts)
        .orderBy(asc(alerts.name))
        .limit(query.pageSize)
        .offset(offset);

      const summaries: AlertSummary[] = [];

      for (const row of rows) {
        const [channelCountRow] = await db
          .select({ value: count() })
          .from(alertChannels)
          .where(eq(alertChannels.alertId, row.id));

        const [actionCountRow] = await db
          .select({ value: count() })
          .from(alertActions)
          .where(eq(alertActions.alertId, row.id));

        summaries.push({
          id: row.id,
          name: row.name,
          description: row.description,
          enabled: row.enabled,
          triggerType: row.triggerType,
          revision: row.revision,
          channelCount: channelCountRow?.value ?? 0,
          actionCount: actionCountRow?.value ?? 0,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      }

      return {
        data: summaries,
        pagination: { page: query.page, pageSize: query.pageSize, total, totalPages },
      };
    });
  }

  /** Get alert by ID with full detail. */
  static async getById(id: string): Promise<Result<AlertDetail>> {
    return tryCatch(async () => {
      return fetchAlertDetail(id);
    });
  }

  /** Create a new alert. */
  static async create(input: CreateAlertInput, context?: AuditContext): Promise<Result<AlertDetail>> {
    return tryCatch(async () => {
      // Check unique name
      const [existing] = await db
        .select({ id: alerts.id })
        .from(alerts)
        .where(eq(alerts.name, input.name));

      if (existing) {
        throw new ServiceError('ALREADY_EXISTS', `Alert "${input.name}" already exists`);
      }

      const triggerScript = JSON.stringify({
        errorTypes: input.trigger.errorTypes,
        regex: input.trigger.regex,
      });

      const [row] = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(alerts)
          .values({
            name: input.name,
            description: input.description,
            enabled: input.enabled,
            triggerType: input.trigger.type,
            triggerScript,
            subjectTemplate: input.subjectTemplate,
            bodyTemplate: input.bodyTemplate,
            reAlertIntervalMs: input.reAlertIntervalMs,
            maxAlerts: input.maxAlerts,
          })
          .returning();

        const alertId = inserted[0]!.id;

        // Insert channel associations
        if (input.channelIds.length > 0) {
          await tx.insert(alertChannels).values(
            input.channelIds.map((channelId) => ({ alertId, channelId })),
          );
        }

        // Insert actions
        if (input.actions.length > 0) {
          await tx.insert(alertActions).values(
            input.actions.map((action) => ({
              alertId,
              actionType: action.type,
              recipients: action.type === 'EMAIL'
                ? action.recipients
                : (action as { recipients?: readonly string[] }).recipients ?? [],
              properties: action.type === 'CHANNEL'
                ? { channelId: (action as { channelId: string }).channelId }
                : null,
            })),
          );
        }

        return inserted;
      });

      const detail = await fetchAlertDetail(row!.id);

      emitEvent({
        level: 'INFO', name: 'ALERT_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'create', alertId: row!.id, alertName: input.name },
      });

      return detail;
    });
  }

  /** Update an alert (optimistic locking). */
  static async update(
    id: string,
    input: UpdateAlertInput,
    context?: AuditContext,
  ): Promise<Result<AlertDetail>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select()
        .from(alerts)
        .where(eq(alerts.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Alert ${id} not found`);
      }

      if (existing.revision !== input.revision) {
        throw new ServiceError('CONFLICT', 'Alert has been modified by another user');
      }

      // Check duplicate name if changing
      if (input.name !== undefined && input.name !== existing.name) {
        const [dup] = await db
          .select({ id: alerts.id })
          .from(alerts)
          .where(eq(alerts.name, input.name));

        if (dup) {
          throw new ServiceError('ALREADY_EXISTS', `Alert "${input.name}" already exists`);
        }
      }

      // Build update fields
      const updates: Record<string, unknown> = {
        revision: existing.revision + 1,
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updates['name'] = input.name;
      if (input.description !== undefined) updates['description'] = input.description;
      if (input.enabled !== undefined) updates['enabled'] = input.enabled;
      if (input.subjectTemplate !== undefined) updates['subjectTemplate'] = input.subjectTemplate;
      if (input.bodyTemplate !== undefined) updates['bodyTemplate'] = input.bodyTemplate;
      if (input.reAlertIntervalMs !== undefined) updates['reAlertIntervalMs'] = input.reAlertIntervalMs;
      if (input.maxAlerts !== undefined) updates['maxAlerts'] = input.maxAlerts;

      if (input.trigger !== undefined) {
        updates['triggerType'] = input.trigger.type;
        updates['triggerScript'] = JSON.stringify({
          errorTypes: input.trigger.errorTypes,
          regex: input.trigger.regex,
        });
      }

      await db.transaction(async (tx) => {
        await tx
          .update(alerts)
          .set(updates)
          .where(eq(alerts.id, id));

        // Delete-and-reinsert channels if provided
        if (input.channelIds !== undefined) {
          await tx.delete(alertChannels).where(eq(alertChannels.alertId, id));
          if (input.channelIds.length > 0) {
            await tx.insert(alertChannels).values(
              input.channelIds.map((channelId) => ({ alertId: id, channelId })),
            );
          }
        }

        // Delete-and-reinsert actions if provided
        if (input.actions !== undefined) {
          await tx.delete(alertActions).where(eq(alertActions.alertId, id));
          if (input.actions.length > 0) {
            await tx.insert(alertActions).values(
              input.actions.map((action) => ({
                alertId: id,
                actionType: action.type,
                recipients: action.type === 'EMAIL'
                  ? action.recipients
                  : (action as { recipients?: readonly string[] }).recipients ?? [],
                properties: action.type === 'CHANNEL'
                  ? { channelId: (action as { channelId: string }).channelId }
                  : null,
              })),
            );
          }
        }
      });

      const detail = await fetchAlertDetail(id);

      emitEvent({
        level: 'INFO', name: 'ALERT_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'update', alertId: id },
      });

      return detail;
    });
  }

  /** Delete an alert. */
  static async delete(id: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: alerts.id })
        .from(alerts)
        .where(eq(alerts.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Alert ${id} not found`);
      }

      await db.delete(alerts).where(eq(alerts.id, id));

      emitEvent({
        level: 'INFO', name: 'ALERT_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'delete', alertId: id },
      });
    });
  }

  /** Toggle alert enabled/disabled (no revision check). */
  static async setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<Result<AlertDetail>> {
    return tryCatch(async () => {
      const [existing] = await db
        .select({ id: alerts.id })
        .from(alerts)
        .where(eq(alerts.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `Alert ${id} not found`);
      }

      await db
        .update(alerts)
        .set({ enabled, updatedAt: new Date() })
        .where(eq(alerts.id, id));

      return fetchAlertDetail(id);
    });
  }
}
