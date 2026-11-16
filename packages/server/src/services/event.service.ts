// ===========================================
// Event Service
// ===========================================
// Business logic for querying, creating, and purging audit events.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, count, desc, and, inArray, gte, lte, sql } from 'drizzle-orm';
import type { CreateEventInput, EventListQuery } from '@galvaniflow/core-models';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { events } from '../db/schema/index.js';

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
 * Returns undefined when no filter is set.
 */
export function buildEventWhereConditions(query: EventFilter): ReturnType<typeof and> {
  const conditions = [];

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
  static async list(query: EventListQuery): Promise<Result<EventListResult>> {
    return tryCatch(async () => {
      const offset = (query.page - 1) * query.pageSize;
      const where = buildEventWhereConditions(query);

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

  /** Get event by ID with full detail. */
  static async getById(id: number): Promise<Result<EventDetail>> {
    return tryCatch(async () => {
      const [row] = await db
        .select()
        .from(events)
        .where(eq(events.id, id));

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
   * `purge_events`, which refuses N below 1.
   */
  static async purge(olderThanDays: number, actor?: { userId?: string | null; ipAddress?: string | null }): Promise<Result<{ deleted: number }>> {
    return tryCatch(async () => {
      const purged = await db.execute<{ deleted: string | number }>(
        sql`SELECT public.purge_events(${olderThanDays}::integer) AS deleted`,
      );
      const deleted = Number(purged.rows[0]?.deleted ?? 0);

      // Record the purge itself so erasing the audit trail is not invisible. This
      // new event is created after the delete, so it survives the cutoff.
      await EventService.create({
        level: 'WARN', name: 'EVENTS_PURGED', outcome: 'SUCCESS',
        userId: actor?.userId ?? null, channelId: null, serverId: null,
        ipAddress: actor?.ipAddress ?? null,
        attributes: { olderThanDays, deleted },
      });

      return { deleted };
    });
  }
}
