import { tryCatch, type Result } from 'stderr-lib';
import { eq, sql } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { ALL_CHANNELS } from '@galvanigraph/core-models';
import type { ChannelScope } from '../lib/channel-scope.js';
import {
  messageStatistics,
} from '../db/schema/index.js';

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
  readonly sourceConnectorType: string;
  readonly inboundDataType: string;
  readonly outboundDataType: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly received: number;
  readonly filtered: number;
  readonly sent: number;
  readonly errored: number;
  readonly queued: number;
}

export class StatisticsService {
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

  /**
   * The scope filters the QUEUED count in SQL too, so a scoped reader's
   * request never aggregates other channels' queues (D-310).
   */
  static async getAllChannelStatistics(scope: ChannelScope = ALL_CHANNELS): Promise<Result<readonly ChannelStatisticsSummary[]>> {
    return tryCatch(async () => {
      if (scope !== ALL_CHANNELS && scope.length === 0) return [];
      const ids = scope === ALL_CHANNELS ? null : sql.join(scope.map((id) => sql`${id}::uuid`), sql`, `);
      const inChannels = ids === null ? sql`` : sql`AND c.id IN (${ids})`;
      const inQueued = ids === null ? sql`` : sql`AND channel_id IN (${ids})`;
      const result = await db.execute<{
        channel_id: string;
        channel_name: string;
        enabled: boolean;
        source_connector_type: string;
        inbound_data_type: string;
        outbound_data_type: string;
        revision: number;
        updated_at: Date;
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
          c.source_connector_type,
          c.inbound_data_type,
          c.outbound_data_type,
          c.revision,
          c.updated_at,
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
          WHERE status = 'QUEUED' ${inQueued}
          GROUP BY channel_id
        ) q ON q.channel_id = c.id
        WHERE c.deleted_at IS NULL ${inChannels}
        GROUP BY c.id, c.name, c.enabled, c.source_connector_type,
          c.inbound_data_type, c.outbound_data_type, c.revision, c.updated_at, q.queued
        ORDER BY c.name ASC
      `);

      return result.rows.map(row => ({
        channelId: row.channel_id,
        channelName: row.channel_name,
        enabled: row.enabled,
        sourceConnectorType: row.source_connector_type,
        inboundDataType: row.inbound_data_type,
        outboundDataType: row.outbound_data_type,
        revision: Number(row.revision),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
        received: Number(row.received),
        filtered: Number(row.filtered),
        sent: Number(row.sent),
        errored: Number(row.errored),
        queued: Number(row.queued),
      }));
    });
  }

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
    });
  }
}
