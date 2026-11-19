import { tryCatch, type Result } from 'stderr-lib';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db.js';
import logger from '../lib/logger.js';

const PARTITIONED_TABLES = [
  'messages',
  'connector_messages',
  'message_content',
  'message_statistics',
  'message_attachments',
  'message_custom_metadata',
] as const;

export type PartitionExecutor = Pick<typeof db, 'execute'>;

/** Hyphens are invalid in unquoted PostgreSQL identifiers. */
function sanitizeChannelId(channelId: string): string {
  return channelId.replace(/-/g, '_');
}

function partitionName(parentTable: string, sanitizedId: string): string {
  return `${parentTable}_p_${sanitizedId}`;
}

export class PartitionManagerService {
  /**
   * The server's role owns no tables (D-307), so this calls the owner function
   * `create_channel_partitions` (migration 0016). It refuses a channel whose
   * row does not exist yet, so a caller writing the row in a transaction passes
   * that transaction as `executor`, and a failure rolls the channel back (#260).
   */
  static async createPartitions(channelId: string, executor: PartitionExecutor = db): Promise<Result<void>> {
    return tryCatch(async () => {
      await executor.execute(sql`SELECT public.create_channel_partitions(${channelId}::uuid)`);
      logger.debug({ channelId }, 'Created partitions for channel');
    });
  }

  /**
   * Makes any missing audit_log month partition from this month through three
   * months on, through the owner function `ensure_audit_partitions` (D-307,
   * migration 0017), and returns how many were made. Rows in a month with no
   * partition land in DEFAULT. A month the function could not make fails this
   * call, after the others were made.
   */
  static async ensureAuditPartitions(): Promise<Result<number>> {
    return tryCatch(async () => {
      const result = await db.execute<{ made: number; failed: string[] | null }>(
        sql`SELECT made, failed FROM public.ensure_audit_partitions()`,
      );
      const made = result.rows[0]?.made ?? 0;
      const failed = result.rows[0]?.failed ?? [];
      if (made > 0) logger.info({ made }, 'Created audit log partitions');
      if (failed.length > 0) {
        throw new Error(`Could not create audit log partitions (see docs/ops/audit-log.md): ${failed.join('; ')}`);
      }
      return made;
    });
  }

  /** Needs the tables' owner (D-307): no server code calls this; integration tests use it to clean up. */
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
