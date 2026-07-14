// ===========================================
// Cross-Channel Search Service
// ===========================================
// Searches messages across all channels.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, gte, lte, inArray, desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { messages, connectorMessages, channels } from '../db/schema/index.js';

// ----- Types -----

export interface SearchItem {
  readonly messageId: number;
  readonly channelId: string;
  readonly channelName: string;
  readonly receivedAt: string;
  readonly processed: boolean;
  readonly status: string | null;
  readonly connectorName: string | null;
}

export interface SearchResult {
  readonly items: readonly SearchItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface SearchFilters {
  readonly status?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly channelIds?: string;
  readonly limit: number;
  readonly offset: number;
}

// ----- Service -----

export class CrossChannelSearchService {
  /** Search messages across all channels with filters. */
  static async search(filters: SearchFilters): Promise<Result<SearchResult>> {
    return tryCatch(async () => {
      // Build WHERE conditions
      const conditions: SQL[] = [];

      if (filters.dateFrom) {
        conditions.push(gte(messages.receivedAt, new Date(filters.dateFrom)));
      }

      if (filters.dateTo) {
        conditions.push(lte(messages.receivedAt, new Date(filters.dateTo)));
      }

      if (filters.channelIds) {
        const ids = filters.channelIds.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        if (ids.length > 0) {
          conditions.push(inArray(messages.channelId, ids));
        }
      }

      // A message matches the status filter if ANY of its connector messages
      // (source OR destination) has that status — so destination send failures,
      // the dominant healthcare failure mode, surface in the triage feed instead
      // of being hidden behind a source-only (metaDataId=0) join.
      if (filters.status) {
        conditions.push(sql`exists (
          select 1 from ${connectorMessages} cm
          where cm.channel_id = ${messages.channelId}
            and cm.message_id = ${messages.id}
            and cm.status = ${filters.status}
        )`);
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Count — one row per message (no connector fan-out).
      const countQuery = db.select({ total: sql<number>`count(*)::int` }).from(messages);
      const countResult = whereClause
        ? await countQuery.where(whereClause)
        : await countQuery;

      const total = countResult[0]?.total ?? 0;

      // Display the most relevant connector for the message: the one matching the
      // status filter (so a QUEUED search shows the queued connector, an ERROR
      // search shows the failed destination), else the errored one, else the
      // source (lowest metaDataId). Scalar subqueries keep one row per message.
      const displayStatus = filters.status ?? 'ERROR';
      const pickStatus = sql<string | null>`(
        select cm.status from ${connectorMessages} cm
        where cm.channel_id = ${messages.channelId} and cm.message_id = ${messages.id}
        order by (cm.status = ${displayStatus}) desc, (cm.status = 'ERROR') desc, cm.meta_data_id asc limit 1
      )`;
      const pickConnector = sql<string | null>`(
        select cm.connector_name from ${connectorMessages} cm
        where cm.channel_id = ${messages.channelId} and cm.message_id = ${messages.id}
        order by (cm.status = ${displayStatus}) desc, (cm.status = 'ERROR') desc, cm.meta_data_id asc limit 1
      )`;

      // Data
      const dataQuery = db
        .select({
          messageId: messages.id,
          channelId: messages.channelId,
          channelName: sql<string>`coalesce(${channels.name}, 'Unknown')`,
          receivedAt: messages.receivedAt,
          processed: messages.processed,
          status: pickStatus,
          connectorName: pickConnector,
        })
        .from(messages)
        .leftJoin(channels, eq(channels.id, messages.channelId))
        .orderBy(desc(messages.receivedAt))
        .limit(filters.limit)
        .offset(filters.offset);

      const rows = whereClause
        ? await dataQuery.where(whereClause)
        : await dataQuery;

      const items: SearchItem[] = rows.map((row) => ({
        messageId: row.messageId,
        channelId: row.channelId,
        channelName: row.channelName,
        receivedAt: row.receivedAt.toISOString(),
        processed: row.processed,
        status: row.status ?? null,
        connectorName: row.connectorName ?? null,
      }));

      return {
        items,
        total,
        limit: filters.limit,
        offset: filters.offset,
      };
    });
  }
}
