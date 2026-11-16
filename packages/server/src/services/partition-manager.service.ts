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

/** What runs the partition function: the global db, or a transaction on it. */
export type PartitionExecutor = Pick<typeof db, 'execute'>;

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
   * Create partitions for all message-related tables for a given channel, if missing.
   * Only the tables' owner may add a partition, and the server's role owns no
   * tables (D-307), so this calls the owner function `create_channel_partitions`
   * (migration 0016), which creates the same six `<table>_p_<id>` partitions.
   * The function refuses a channel whose row does not exist yet, so a caller
   * that writes the row in a transaction passes that transaction as
   * `executor`: a failure then rolls the channel back with it (#260).
   */
  static async createPartitions(channelId: string, executor: PartitionExecutor = db): Promise<Result<void>> {
    return tryCatch(async () => {
      await executor.execute(sql`SELECT public.create_channel_partitions(${channelId}::uuid)`);
      logger.debug({ channelId }, 'Created partitions for channel');
    });
  }

  /**
   * Drop partitions for all message-related tables for a given channel.
   * Uses DROP TABLE IF EXISTS ... CASCADE. Needs the tables' owner: the
   * production server's role cannot drop a table (D-307), and no server code
   * calls this; the integration tests use it to clean up.
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
