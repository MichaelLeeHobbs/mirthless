// ===========================================
// Statistics Service
// ===========================================
// Aggregation queries for channel statistics to power the dashboard.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, sql } from 'drizzle-orm';
import { db } from '../lib/db.js';
import {
  messageStatistics,
} from '../db/schema/index.js';

// ----- Response Types -----

export interface ConnectorStats {
  readonly metaDataId: number | null;
  readonly serverId: string;
  readonly received: number;
  readonly filtered: number;
  readonly sent: number;
  readonly errored: number;
  readonly receivedLifetime: number;
  readonly filteredLifetime: number;
  readonly sentLifetime: number;
  readonly erroredLifetime: number;
}

export interface ChannelStatistics {
  readonly channelId: string;
  readonly connectors: readonly ConnectorStats[];
}

export interface ChannelStatisticsSummary {
  readonly channelId: string;
  readonly channelName: string;
  readonly enabled: boolean;
  readonly received: number;
  readonly filtered: number;
  readonly sent: number;
  readonly errored: number;
  readonly queued: number;
}

// ----- Service -----

export class StatisticsService {
  /** Get per-channel statistics with connector breakdown. */
  static async getChannelStatistics(
    channelId: string,
  ): Promise<Result<ChannelStatistics>> {
    return tryCatch(async () => {
      const rows = await db
        .select()
        .from(messageStatistics)
        .where(eq(messageStatistics.channelId, channelId));

      const connectors: ConnectorStats[] = rows.map(row => ({
        metaDataId: row.metaDataId,
        serverId: row.serverId,
        received: row.received,
        filtered: row.filtered,
        sent: row.sent,
        errored: row.errored,
        receivedLifetime: row.receivedLifetime,
        filteredLifetime: row.filteredLifetime,
        sentLifetime: row.sentLifetime,
        erroredLifetime: row.erroredLifetime,
      }));

      return { channelId, connectors };
    });
  }

  /** Get summary statistics for all channels (for dashboard). */
  static async getAllChannelStatistics(): Promise<Result<readonly ChannelStatisticsSummary[]>> {
    return tryCatch(async () => {
      const result = await db.execute<{
        channel_id: string;
        channel_name: string;
        enabled: boolean;
        received: string;
        filtered: string;
        sent: string;
        errored: string;
        queued: string;
      }>(sql`
        SELECT
          c.id as channel_id,
          c.name as channel_name,
          c.enabled,
          COALESCE(SUM(ms.received), 0) as received,
          COALESCE(SUM(ms.filtered), 0) as filtered,
          COALESCE(SUM(ms.sent), 0) as sent,
          COALESCE(SUM(ms.errored), 0) as errored,
          COALESCE(q.queued, 0) as queued
        FROM channels c
        LEFT JOIN message_statistics ms ON ms.channel_id = c.id
        LEFT JOIN (
          SELECT channel_id, COUNT(*) as queued
          FROM connector_messages
          WHERE status = 'QUEUED'
          GROUP BY channel_id
        ) q ON q.channel_id = c.id
        WHERE c.deleted_at IS NULL
        GROUP BY c.id, c.name, c.enabled, q.queued
        ORDER BY c.name ASC
      `);

      return result.rows.map(row => ({
        channelId: row.channel_id,
        channelName: row.channel_name,
        enabled: row.enabled,
        received: Number(row.received),
        filtered: Number(row.filtered),
        sent: Number(row.sent),
        errored: Number(row.errored),
        queued: Number(row.queued),
      }));
    });
  }

  /** Reset current-window counters for a channel (preserves lifetime). */
  static async resetStatistics(
    channelId: string,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      await db
        .update(messageStatistics)
        .set({
          received: 0,
          filtered: 0,
          sent: 0,
          errored: 0,
        })
        .where(eq(messageStatistics.channelId, channelId));

      // No error if nothing to reset — channel may have no stats yet
    });
  }
}
