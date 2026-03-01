// ===========================================
// Event Service
// ===========================================
// Business logic for querying, creating, and purging audit events.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, count, desc, and, inArray, gte, lte, sql } from 'drizzle-orm';
import type { CreateEventInput, EventListQuery } from '@mirthless/core-models';
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

function buildWhereConditions(query: EventListQuery): ReturnType<typeof and> {
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
      const where = buildWhereConditions(query);

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

  /** Purge events older than N days. Admin-only. */
  static async purge(olderThanDays: number): Promise<Result<{ deleted: number }>> {
    return tryCatch(async () => {
      const result = await db
        .delete(events)
        .where(lte(events.createdAt, sql`now() - ${String(olderThanDays)} * interval '1 day'`))
        .returning({ id: events.id });

      return { deleted: result.length };
    });
  }
}
