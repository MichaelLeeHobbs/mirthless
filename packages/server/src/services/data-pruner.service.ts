// ===========================================
// Data Pruner Service
// ===========================================
// Bulk deletion of old messages by channel pruning configuration.
// Deletes messages older than the configured retention period.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, lt, isNull, sql } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import {
  channels,
  messages,
} from '../db/schema/index.js';
import { deleteMessagesByIds } from './message-delete-helper.js';

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
 * Delete all message-related records older than cutoffDate for a channel.
 * Deletes in dependency order: attachments, custom metadata, content,
 * connector messages, then messages.
 */
async function deleteOldMessages(
  channelId: string,
  cutoffDate: Date,
): Promise<number> {
  // Find message IDs to prune
  const staleMessages = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.channelId, channelId),
        lt(messages.receivedAt, cutoffDate),
      ),
    );

  if (staleMessages.length === 0) {
    return 0;
  }

  const messageIds = staleMessages.map((m) => m.id);

  // Delete in dependency order (transactional)
  await deleteMessagesByIds(channelId, messageIds);

  return messageIds.length;
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

      for (const ch of prunableChannels) {
        const maxAge = ch.pruningMaxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
        const cutoff = computeCutoffDate(maxAge);
        const deleted = await deleteOldMessages(ch.id, cutoff);
        if (deleted > 0) {
          channelsPruned++;
          totalDeleted += deleted;
        }
      }

      emitEvent({
        level: 'INFO',
        name: 'DATA_PRUNER_RAN',
        outcome: 'SUCCESS',
        userId: context?.userId ?? null,
        channelId: null,
        serverId: null,
        ipAddress: context?.ipAddress ?? null,
        attributes: { channelsPruned, totalDeleted },
      });

      return { channelsPruned, totalDeleted };
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
          FROM messages
          WHERE channel_id = ${ch.id}
            AND received_at < ${cutoff.toISOString()}
        `);

        const prunableCount = Number(countResult.rows[0]?.count ?? 0);
        results.push({ channelId: ch.id, prunableCount });
      }

      return results;
    });
  }
}
