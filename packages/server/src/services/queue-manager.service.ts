// ===========================================
// Queue Manager Service
// ===========================================
// Handles queue operations: dequeue with row-level locking,
// release, requeue failed messages, and queue depth queries.
// Complements MessageService for advanced queue management.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, sql } from 'drizzle-orm';
import type { MessageStatus } from '@mirthless/core-models';
import { db } from '../lib/db.js';
import {
  connectorMessages,
  type ConnectorMessage,
} from '../db/schema/index.js';

// ----- Types -----

/** A message claimed from the queue via FOR UPDATE SKIP LOCKED. */
export type QueuedMessage = Readonly<ConnectorMessage>;

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
   * Dequeue messages for processing. Uses FOR UPDATE SKIP LOCKED
   * to allow concurrent consumers without conflicts.
   */
  static async dequeue(
    channelId: string,
    metaDataId: number,
    batchSize: number,
  ): Promise<Result<ReadonlyArray<QueuedMessage>>> {
    return tryCatch(async () => {
      const result = await db.execute<ConnectorMessage>(sql`
        SELECT *
        FROM connector_messages
        WHERE channel_id = ${channelId}
          AND meta_data_id = ${metaDataId}
          AND status = 'QUEUED'
        ORDER BY message_id ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `);
      return result.rows;
    });
  }

  /**
   * Release a dequeued message with a new status (SENT, ERROR, etc.).
   * Sets sendDate when the new status is SENT.
   */
  static async release(
    channelId: string,
    messageId: number,
    metaDataId: number,
    newStatus: MessageStatus,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const updates: Record<string, unknown> = { status: newStatus };
      if (newStatus === 'SENT') {
        updates['sendDate'] = new Date();
      }
      await db
        .update(connectorMessages)
        .set(updates)
        .where(
          and(
            eq(connectorMessages.channelId, channelId),
            eq(connectorMessages.messageId, messageId),
            eq(connectorMessages.metaDataId, metaDataId),
          ),
        );
    });
  }

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
