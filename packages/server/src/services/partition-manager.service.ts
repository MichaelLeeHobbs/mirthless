// ===========================================
// Partition Manager Service
// ===========================================
// Manages PostgreSQL table partitions for per-channel message storage.
// Each channel gets its own partition of the message-related tables,
// using list partitioning on channel_id.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db.js';
import logger from '../lib/logger.js';

// ----- Constants -----

/**
 * Parent tables that are partitioned by channel_id.
 * Each entry maps to a real table defined in the schema.
 */
const PARTITIONED_TABLES = [
  'messages',
  'connector_messages',
  'message_content',
  'message_statistics',
  'message_attachments',
  'message_custom_metadata',
] as const;

// ----- Helpers -----

/**
 * Sanitize a UUID channel ID for use in a PostgreSQL table name.
 * Replaces hyphens with underscores since hyphens are invalid in identifiers.
 */
function sanitizeChannelId(channelId: string): string {
  return channelId.replace(/-/g, '_');
}

/** Build the partition table name for a given parent table and channel ID. */
function partitionName(parentTable: string, sanitizedId: string): string {
  return `${parentTable}_p_${sanitizedId}`;
}

// ----- Service -----

export class PartitionManagerService {
  /**
   * Create partitions for all message-related tables for a given channel.
   * Uses CREATE TABLE IF NOT EXISTS with PARTITION OF ... FOR VALUES IN.
   */
  static async createPartitions(channelId: string): Promise<Result<void>> {
    return tryCatch(async () => {
      const sanitizedId = sanitizeChannelId(channelId);

      for (const parentTable of PARTITIONED_TABLES) {
        const partition = partitionName(parentTable, sanitizedId);
        await db.execute(
          sql.raw(
            `CREATE TABLE IF NOT EXISTS "${partition}" PARTITION OF "${parentTable}" FOR VALUES IN ('${channelId}')`
          )
        );
      }

      logger.debug({ channelId }, 'Created partitions for channel');
    });
  }

  /**
   * Drop partitions for all message-related tables for a given channel.
   * Uses DROP TABLE IF EXISTS ... CASCADE.
   */
  static async dropPartitions(channelId: string): Promise<Result<void>> {
    return tryCatch(async () => {
      const sanitizedId = sanitizeChannelId(channelId);

      for (const parentTable of PARTITIONED_TABLES) {
        const partition = partitionName(parentTable, sanitizedId);
        await db.execute(
          sql.raw(`DROP TABLE IF EXISTS "${partition}" CASCADE`)
        );
      }

      logger.debug({ channelId }, 'Dropped partitions for channel');
    });
  }

  /**
   * Check whether a partition exists for a given channel.
   * Queries pg_tables for the primary partition table name (messages_p_...).
   */
  static async partitionExists(channelId: string): Promise<Result<boolean>> {
    return tryCatch(async () => {
      const sanitizedId = sanitizeChannelId(channelId);
      const partition = partitionName('messages', sanitizedId);

      const result = await db.execute(
        sql.raw(
          `SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = '${partition}') AS "exists"`
        )
      );

      const rows = result.rows as unknown as ReadonlyArray<{ readonly exists: boolean }>;
      return rows[0]?.exists === true;
    });
  }
}
