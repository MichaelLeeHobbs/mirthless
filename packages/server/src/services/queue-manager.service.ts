// ===========================================
// Queue Manager Service
// ===========================================
// Requeues failed messages and reports queue depth.
// Dequeue and release live in MessageService.

import { tryCatch, type Result } from 'stderr-lib';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db.js';

// ----- Types -----

/** Result of a requeue operation. */
export interface RequeueResult {
  readonly requeuedCount: number;
}

/** Result of a queue depth query. */
export interface QueueDepthResult {
  readonly depth: number;
}

// ----- Service -----

export class QueueManagerService {
  /**
   * Requeue failed connector messages that are below the retry limit.
   * Increments send_attempts and resets status to QUEUED.
   */
  static async requeueFailed(
    channelId: string,
    maxRetries: number,
  ): Promise<Result<RequeueResult>> {
    return tryCatch(async () => {
      const result = await db.execute<{ count: string }>(sql`
        UPDATE connector_messages
        SET status = 'QUEUED',
            send_attempts = send_attempts + 1
        WHERE channel_id = ${channelId}
          AND status = 'ERROR'
          AND send_attempts < ${maxRetries}
        RETURNING COUNT(*) OVER() AS count
      `);

      const row = result.rows[0];
      return { requeuedCount: Number(row?.count ?? 0) };
    });
  }

  /**
   * Get the number of QUEUED connector messages for a channel/connector.
   */
  static async getQueueDepth(
    channelId: string,
    metaDataId: number,
  ): Promise<Result<QueueDepthResult>> {
    return tryCatch(async () => {
      const result = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count
        FROM connector_messages
        WHERE channel_id = ${channelId}
          AND meta_data_id = ${metaDataId}
          AND status = 'QUEUED'
      `);

      const row = result.rows[0];
      return { depth: Number(row?.count ?? 0) };
    });
  }
}
