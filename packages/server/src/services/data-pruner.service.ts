// ===========================================
// Data Pruner Service
// ===========================================
// Bulk deletion of old messages by channel pruning configuration.
// Deletes messages older than the configured retention period.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import logger from '../lib/logger.js';
import { channels } from '../db/schema/index.js';
import { deleteMessagesByIds, DELETE_BATCH_SIZE } from './message-delete-helper.js';

// ----- Constants -----

const DEFAULT_MAX_AGE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ----- Response Types -----

export interface PruneChannelResult {
  readonly deletedCount: number;
}

export interface PruneAllResult {
  readonly channelsPruned: number;
  readonly totalDeleted: number;
  /** Channels whose prune failed. The others were still pruned. */
  readonly failedChannelIds: readonly string[];
}

export interface PrunableChannelStats {
  readonly channelId: string;
  readonly prunableCount: number;
}

// ----- Private Helpers -----

function computeCutoffDate(maxAgeDays: number): Date {
  return new Date(Date.now() - maxAgeDays * MS_PER_DAY);
}

/**
 * Messages of a channel that are old enough AND finished. A message that is still
 * unprocessed, or has a destination waiting in the queue, is never pruned however
 * old it is: deleting it would silently lose a message that was never delivered.
 */
function prunableWhere(channelId: string, cutoffDate: Date): SQL {
  return sql`
    m.channel_id = ${channelId}
    AND m.received_at < ${cutoffDate.toISOString()}
    AND m.processed = true
    AND NOT EXISTS (
      SELECT 1 FROM connector_messages cm
      WHERE cm.channel_id = m.channel_id
        AND cm.message_id = m.id
        AND cm.status IN ('QUEUED', 'PENDING')
    )
  `;
}

/**
 * Delete finished messages older than cutoffDate for a channel, one bounded batch
 * at a time, so the work never depends on how many messages there are.
 */
async function deleteOldMessages(
  channelId: string,
  cutoffDate: Date,
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const batch = await db.execute<{ id: number | string }>(sql`
      SELECT m.id FROM messages m
      WHERE ${prunableWhere(channelId, cutoffDate)}
      ORDER BY m.id
      LIMIT ${DELETE_BATCH_SIZE}
    `);
    const messageIds = batch.rows.map((row) => Number(row.id));
    if (messageIds.length === 0) return deleted;

    await deleteMessagesByIds(channelId, messageIds);
    deleted += messageIds.length;
    if (messageIds.length < DELETE_BATCH_SIZE) return deleted;
  }
}

// ----- Service -----

export class DataPrunerService {
  /**
   * Prune messages older than maxAgeDays for a specific channel.
   * Deletes all related records (content, connector messages, attachments, custom metadata).
   */
  static async pruneChannel(
    channelId: string,
    maxAgeDays: number,
    context?: AuditContext,
  ): Promise<Result<PruneChannelResult>> {
    return tryCatch(async () => {
      const cutoffDate = computeCutoffDate(maxAgeDays);
      const deletedCount = await deleteOldMessages(channelId, cutoffDate);

      emitEvent({
        level: 'INFO',
        name: 'DATA_PRUNER_RAN',
        outcome: 'SUCCESS',
        userId: context?.userId ?? null,
        channelId,
        serverId: null,
        ipAddress: context?.ipAddress ?? null,
        attributes: { maxAgeDays, deletedCount },
      });

      return { deletedCount };
    });
  }

  /**
   * Prune all channels that have pruning enabled.
   * Uses each channel's configured maxAgeDays (or default 30 days).
   */
  static async pruneAll(
    context?: AuditContext,
  ): Promise<Result<PruneAllResult>> {
    return tryCatch(async () => {
      const prunableChannels = await db
        .select({
          id: channels.id,
          pruningMaxAgeDays: channels.pruningMaxAgeDays,
        })
        .from(channels)
        .where(
          and(
            eq(channels.pruningEnabled, true),
            isNull(channels.deletedAt),
          ),
        );

      let totalDeleted = 0;
      let channelsPruned = 0;
      const failedChannelIds: string[] = [];

      for (const ch of prunableChannels) {
        const maxAge = ch.pruningMaxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
        const cutoff = computeCutoffDate(maxAge);
        // One channel failing must not stop the others from being pruned.
        const pruned = await tryCatch(deleteOldMessages(ch.id, cutoff));
        if (!pruned.ok) {
          failedChannelIds.push(ch.id);
          logger.error({ channelId: ch.id, errMsg: pruned.error.message }, 'Data pruner failed for channel');
          continue;
        }
        if (pruned.value > 0) {
          channelsPruned++;
          totalDeleted += pruned.value;
        }
      }

      emitEvent({
        level: failedChannelIds.length > 0 ? 'ERROR' : 'INFO',
        name: 'DATA_PRUNER_RAN',
        outcome: failedChannelIds.length > 0 ? 'FAILURE' : 'SUCCESS',
        userId: context?.userId ?? null,
        channelId: null,
        serverId: null,
        ipAddress: context?.ipAddress ?? null,
        attributes: { channelsPruned, totalDeleted, failedChannelIds },
      });

      return { channelsPruned, totalDeleted, failedChannelIds };
    });
  }

  /**
   * Get prunable message counts per channel.
   * Returns counts of messages older than each channel's pruning threshold.
   */
  static async getStatistics(): Promise<Result<ReadonlyArray<PrunableChannelStats>>> {
    return tryCatch(async () => {
      const prunableChannels = await db
        .select({
          id: channels.id,
          pruningMaxAgeDays: channels.pruningMaxAgeDays,
        })
        .from(channels)
        .where(
          and(
            eq(channels.pruningEnabled, true),
            isNull(channels.deletedAt),
          ),
        );

      const results: PrunableChannelStats[] = [];

      for (const ch of prunableChannels) {
        const maxAge = ch.pruningMaxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
        const cutoff = computeCutoffDate(maxAge);

        const countResult = await db.execute<{ count: string }>(sql`
          SELECT COUNT(*) as count
          FROM messages m
          WHERE ${prunableWhere(ch.id, cutoff)}
        `);

        const prunableCount = Number(countResult.rows[0]?.count ?? 0);
        results.push({ channelId: ch.id, prunableCount });
      }

      return results;
    });
  }
}
