// ===========================================
// Event Service
// ===========================================
// Business logic for querying, creating, and purging audit events.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, count, desc, and, inArray, gte, lte, sql } from 'drizzle-orm';
import { AUDIT_ACTION, type CreateEventInput, type EventListQuery } from '@galvanigraph/core-models';
import { AuditService } from './audit.service.js';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { events } from '../db/schema/index.js';
import { ALL_CHANNELS } from '@galvanigraph/core-models';
import { channelIdIn, type ChannelScope } from '../lib/channel-scope.js';

// ----- Response Types -----

export interface EventSummary {
  readonly id: number;
  readonly level: string;
  readonly name: string;
  readonly outcome: string;
  readonly userId: string | null;
  readonly channelId: string | null;
  readonly ipAddress: string | null;
  readonly createdAt: Date;
}

export interface EventDetail extends EventSummary {
  readonly serverId: string | null;
  readonly attributes: Record<string, unknown> | null;
}

export interface EventListResult {
  readonly data: readonly EventSummary[];
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

// ----- Helpers -----

/** The event filters shared by the event list and the event export. */
export type EventFilter = Pick<EventListQuery, 'level' | 'name' | 'outcome' | 'userId' | 'channelId' | 'startDate' | 'endDate'>;

/**
 * Builds the WHERE clause for an event query. `level` and `name` are comma-separated lists.
 * A scoped caller sees only the events of channels inside `scope`, and no
 * system-wide events (D-310). Returns undefined when no filter is set.
 */
export function buildEventWhereConditions(query: EventFilter, scope: ChannelScope = ALL_CHANNELS): ReturnType<typeof and> {
  const conditions = [];

  const inScope = channelIdIn(events.channelId, scope);
  if (inScope !== undefined) conditions.push(inScope);

  if (query.level !== undefined) {
    const levels = query.level.split(',').map((s) => s.trim());
    conditions.push(inArray(events.level, levels));
  }

  if (query.name !== undefined) {
    const names = query.name.split(',').map((s) => s.trim());
    conditions.push(inArray(events.name, names));
  }

  if (query.outcome !== undefined) {
    conditions.push(eq(events.outcome, query.outcome));
  }

  if (query.userId !== undefined) {
    conditions.push(eq(events.userId, query.userId));
  }

  if (query.channelId !== undefined) {
    conditions.push(eq(events.channelId, query.channelId));
  }

  if (query.startDate !== undefined) {
    conditions.push(gte(events.createdAt, new Date(query.startDate)));
  }

  if (query.endDate !== undefined) {
    conditions.push(lte(events.createdAt, new Date(query.endDate)));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

// ----- Service -----

export class EventService {
  /** List events with pagination and filters. */
  static async list(query: EventListQuery, scope: ChannelScope = ALL_CHANNELS): Promise<Result<EventListResult>> {
    return tryCatch(async () => {
      const offset = (query.page - 1) * query.pageSize;
      const where = buildEventWhereConditions(query, scope);

      const countQuery = db
        .select({ value: count() })
        .from(events);

      const [totalRow] = where !== undefined
        ? await countQuery.where(where)
        : await countQuery;

      const total = totalRow?.value ?? 0;
      const totalPages = Math.ceil(total / query.pageSize);

      const dataQuery = db
        .select()
        .from(events);

      const rows = where !== undefined
        ? await dataQuery.where(where).orderBy(desc(events.createdAt)).limit(query.pageSize).offset(offset)
        : await dataQuery.orderBy(desc(events.createdAt)).limit(query.pageSize).offset(offset);

      const data: EventSummary[] = rows.map((row) => ({
        id: row.id,
        level: row.level,
        name: row.name,
        outcome: row.outcome,
        userId: row.userId ?? null,
        channelId: row.channelId ?? null,
        ipAddress: row.ipAddress ?? null,
        createdAt: row.createdAt,
      }));

      return {
        data,
        pagination: { page: query.page, pageSize: query.pageSize, total, totalPages },
      };
    });
  }

  /** Get event by ID with full detail; one outside `scope` reads as not found. */
  static async getById(id: number, scope: ChannelScope = ALL_CHANNELS): Promise<Result<EventDetail>> {
    return tryCatch(async () => {
      const [row] = await db
        .select()
        .from(events)
        .where(and(eq(events.id, id), channelIdIn(events.channelId, scope)));

      if (!row) {
        throw new ServiceError('NOT_FOUND', `Event ${String(id)} not found`);
      }

      return {
        id: row.id,
        level: row.level,
        name: row.name,
        outcome: row.outcome,
        userId: row.userId ?? null,
        channelId: row.channelId ?? null,
        ipAddress: row.ipAddress ?? null,
        serverId: row.serverId ?? null,
        attributes: row.attributes ?? null,
        createdAt: row.createdAt,
      };
    });
  }

  /** Whether an event named `name` was recorded for `userId` at or after `since`. */
  static async hasEventSince(name: string, userId: string, since: Date): Promise<Result<boolean>> {
    return tryCatch(async () => {
      const [row] = await db.select({ id: events.id }).from(events)
        .where(and(eq(events.name, name), eq(events.userId, userId), gte(events.createdAt, since)))
        .limit(1);
      return row !== undefined;
    });
  }

  /** Create a new audit event. Internal use only. */
  static async create(input: CreateEventInput): Promise<Result<EventDetail>> {
    return tryCatch(async () => {
      const [row] = await db
        .insert(events)
        .values({
          level: input.level,
          name: input.name,
          outcome: input.outcome,
          userId: input.userId,
          channelId: input.channelId,
          serverId: input.serverId,
          ipAddress: input.ipAddress,
          attributes: input.attributes,
        })
        .returning();

      return {
        id: row!.id,
        level: row!.level,
        name: row!.name,
        outcome: row!.outcome,
        userId: row!.userId ?? null,
        channelId: row!.channelId ?? null,
        ipAddress: row!.ipAddress ?? null,
        serverId: row!.serverId ?? null,
        attributes: row!.attributes ?? null,
        createdAt: row!.createdAt,
      };
    });
  }

  /**
   * Purge events at least N days old (N >= 1). Admin-only. The server's database
   * role cannot delete events itself (D-307), so this calls the owner function
   * `purge_events`, which refuses N below 1. The purge and its record in the
   * protected audit log share one transaction (D-312): when the record cannot
   * be written the purge rolls back, and a purge that fails is not recorded
   * as done.
   */
  static async purge(olderThanDays: number, actor?: { userId?: string | null; ipAddress?: string | null }): Promise<Result<{ deleted: number }>> {
    return tryCatch(async () => db.transaction(async (tx) => {
      const purged = await tx.execute<{ deleted: string | number }>(
        sql`SELECT public.purge_events(${olderThanDays}::integer) AS deleted`,
      );
      const deleted = Number(purged.rows[0]?.deleted ?? 0);
      try {
        await AuditService.recordInTx(tx, {
          action: AUDIT_ACTION.EVENTS_PURGED, outcome: 'SUCCESS',
          userId: actor?.userId ?? null, ipAddress: actor?.ipAddress ?? null,
          attributes: { olderThanDays, deleted },
        });
      } catch {
        throw new ServiceError('AUDIT_UNAVAILABLE', 'The audit log could not record this purge, so nothing was purged.');
      }
      return { deleted };
    }));
  }
}
