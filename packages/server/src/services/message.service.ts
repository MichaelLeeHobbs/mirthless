// ===========================================
// Message Service
// ===========================================
// Data access layer for message storage and retrieval.
// Used by the engine to persist messages as they flow through the pipeline.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, sql } from 'drizzle-orm';
import { SOCKET_EVENT, type ContentType, type MessageStatus } from '@mirthless/core-models';
import { db } from '../lib/db.js';
import { emitToRoom } from '../lib/socket.js';
import { decryptIfEncrypted } from '../lib/content-crypto.js';
import {
  messages,
  connectorMessages,
  messageContent,
  messageAttachments,
  messageStatistics,
  type ConnectorMessage,
  type Message,
  type MessageStatistic,
} from '../db/schema/index.js';

// ----- Response Types -----

export interface CreateMessageResult {
  readonly messageId: number;
  readonly correlationId: string;
}

export interface ChannelStatistics {
  readonly channelId: string;
  readonly entries: readonly MessageStatistic[];
}

// ----- Stat Field Type -----

type StatField = 'received' | 'filtered' | 'sent' | 'errored';

// ----- Service -----

export class MessageService {
  /** Create a new message record. Returns the auto-generated message ID and correlation ID. */
  static async createMessage(
    channelId: string,
    serverId: string,
    correlationId?: string,
  ): Promise<Result<CreateMessageResult>> {
    return tryCatch(async () => {
      const values: Record<string, unknown> = { channelId, serverId };
      if (correlationId) values['correlationId'] = correlationId;
      const [row] = await db
        .insert(messages)
        .values(values as typeof messages.$inferInsert)
        .returning({ messageId: messages.id, correlationId: messages.correlationId });

      return { messageId: row!.messageId, correlationId: row!.correlationId };
    });
  }

  /** Create a connector message (source metaDataId=0, destinations 1+). */
  static async createConnectorMessage(
    channelId: string,
    messageId: number,
    metaDataId: number,
    connectorName: string,
    status: MessageStatus,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      await db.insert(connectorMessages).values({
        channelId,
        messageId,
        metaDataId,
        connectorName,
        status,
      });

      emitToRoom(`channel:${channelId}`, SOCKET_EVENT.MESSAGE_NEW, { channelId, messageId, metaDataId });
    });
  }

  /** Update a connector message status. Optionally set errorCode. */
  static async updateConnectorMessageStatus(
    channelId: string,
    messageId: number,
    metaDataId: number,
    status: MessageStatus,
    errorCode?: number,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const updates: Record<string, unknown> = { status };
      if (status === 'SENT') {
        updates['sendDate'] = new Date();
      }
      // Requeue-after-failure path: transitioning back to QUEUED means an attempt
      // was just made. Persist the increment so the retry cap can trip and a
      // poison message cannot be retried forever.
      if (status === 'QUEUED') {
        updates['sendAttempts'] = sql`${connectorMessages.sendAttempts} + 1`;
      }
      if (errorCode !== undefined) {
        updates['errorCode'] = errorCode;
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

  /** Store message content (raw, transformed, sent, response, etc.). */
  static async storeContent(
    channelId: string,
    messageId: number,
    metaDataId: number,
    contentType: ContentType,
    content: string,
    dataType: string,
    encrypted?: boolean,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      await db.insert(messageContent).values({
        channelId,
        messageId,
        metaDataId,
        contentType,
        content,
        dataType,
        isEncrypted: encrypted ?? false,
      });
    });
  }

  /** Mark a message as fully processed. */
  static async markProcessed(
    channelId: string,
    messageId: number,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      await db
        .update(messages)
        .set({ processed: true, processedAt: new Date() })
        .where(
          and(
            eq(messages.channelId, channelId),
            eq(messages.id, messageId),
          ),
        );
    });
  }

  /**
   * Enqueue a connector message for async delivery.
   * @see QueueManagerService for advanced queue operations (requeueFailed, getQueueDepth).
   */
  static async enqueue(
    channelId: string,
    messageId: number,
    metaDataId: number,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      await db
        .update(connectorMessages)
        .set({ status: 'QUEUED' })
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
   * Atomically claim queued messages for processing.
   *
   * Transitions the selected rows from QUEUED to PENDING in the same statement
   * so a concurrent poll cannot re-dequeue an in-flight message (which would
   * double-dispatch it). FOR UPDATE SKIP LOCKED lets multiple consumers claim
   * disjoint batches without blocking each other. Columns are aliased to
   * camelCase so the returned rows match the QueuedMessage shape the consumer reads.
   * @see QueueManagerService for advanced queue operations (requeueFailed, getQueueDepth).
   */
  static async dequeue(
    channelId: string,
    metaDataId: number,
    batchSize: number,
  ): Promise<Result<readonly ConnectorMessage[]>> {
    return tryCatch(async () => {
      const result = await db.execute<{
        channelId: string; messageId: number; metaDataId: number;
        connectorName: string | null; status: string; sendAttempts: number; errorCode: number;
      }>(sql`
        UPDATE connector_messages
        SET status = 'PENDING'
        WHERE (channel_id, message_id, meta_data_id) IN (
          SELECT channel_id, message_id, meta_data_id
          FROM connector_messages
          WHERE channel_id = ${channelId}
            AND meta_data_id = ${metaDataId}
            AND status = 'QUEUED'
          ORDER BY message_id ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING
          channel_id AS "channelId",
          message_id AS "messageId",
          meta_data_id AS "metaDataId",
          connector_name AS "connectorName",
          status,
          send_attempts AS "sendAttempts",
          error_code AS "errorCode"
      `);
      return result.rows as unknown as readonly ConnectorMessage[];
    });
  }

  /**
   * Reset any messages stuck in PENDING back to QUEUED for a destination.
   *
   * PENDING rows are claimed-but-not-finished dispatches. After a crash or
   * restart they would otherwise be stranded (no consumer owns them), so they
   * must be re-queued for redelivery — a message must never be silently lost.
   */
  static async resetPending(
    channelId: string,
    metaDataId: number,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      await db
        .update(connectorMessages)
        .set({ status: 'QUEUED' })
        .where(
          and(
            eq(connectorMessages.channelId, channelId),
            eq(connectorMessages.metaDataId, metaDataId),
            eq(connectorMessages.status, 'PENDING'),
          ),
        );
    });
  }

  /**
   * Release a dequeued message with a new status (SENT or ERROR).
   * @see QueueManagerService for advanced queue operations (requeueFailed, getQueueDepth).
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

  /** Increment statistics counters for a channel connector. */
  static async incrementStats(
    channelId: string,
    metaDataId: number,
    serverId: string,
    field: StatField,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const lifetimeField = `${field}_lifetime` as const;
      await db.execute(sql`
        INSERT INTO message_statistics (channel_id, meta_data_id, server_id, ${sql.raw(field)}, ${sql.raw(lifetimeField)})
        VALUES (${channelId}, ${metaDataId}, ${serverId}, 1, 1)
        ON CONFLICT (channel_id, meta_data_id, server_id)
        DO UPDATE SET
          ${sql.raw(field)} = message_statistics.${sql.raw(field)} + 1,
          ${sql.raw(lifetimeField)} = message_statistics.${sql.raw(lifetimeField)} + 1
      `);

      emitToRoom('dashboard', SOCKET_EVENT.STATS_UPDATE, { channelId, metaDataId, serverId, field });
    });
  }

  /** Load stored content for a specific message and content type. */
  static async loadContent(
    channelId: string,
    messageId: number,
    metaDataId: number,
    contentType: ContentType,
  ): Promise<Result<string | null>> {
    return tryCatch(async () => {
      const [row] = await db
        .select({ content: messageContent.content })
        .from(messageContent)
        .where(
          and(
            eq(messageContent.channelId, channelId),
            eq(messageContent.messageId, messageId),
            eq(messageContent.metaDataId, metaDataId),
            eq(messageContent.contentType, contentType),
          ),
        );

      // Decrypt if the stored value is an encryption envelope; plaintext (mixed
      // legacy rows / non-encrypted channels) passes through unchanged.
      const decrypted = decryptIfEncrypted(row?.content ?? null);
      if (!decrypted.ok) throw decrypted.error;
      return decrypted.value;
    });
  }

  /** Get statistics for all connectors of a channel. */
  static async getStats(
    channelId: string,
  ): Promise<Result<ChannelStatistics>> {
    return tryCatch(async () => {
      const rows = await db
        .select()
        .from(messageStatistics)
        .where(eq(messageStatistics.channelId, channelId));

      return { channelId, entries: rows };
    });
  }

  /** Get unprocessed messages for recovery after restart. */
  static async getUnprocessedMessages(
    channelId: string,
  ): Promise<Result<readonly Message[]>> {
    return tryCatch(async () => {
      const rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.channelId, channelId),
            eq(messages.processed, false),
          ),
        );
      return rows;
    });
  }

  /** Get all connector messages for a single message (used by recovery to decide per-connector action). */
  static async getConnectorMessages(
    channelId: string,
    messageId: number,
  ): Promise<Result<readonly { messageId: number; metaDataId: number; status: string }[]>> {
    return tryCatch(async () => {
      const rows = await db
        .select({
          messageId: connectorMessages.messageId,
          metaDataId: connectorMessages.metaDataId,
          status: connectorMessages.status,
        })
        .from(connectorMessages)
        .where(
          and(
            eq(connectorMessages.channelId, channelId),
            eq(connectorMessages.messageId, messageId),
          ),
        );
      return rows;
    });
  }

  /** Get queued connector messages for a specific destination. */
  static async getQueuedMessages(
    channelId: string,
    metaDataId: number,
  ): Promise<Result<readonly ConnectorMessage[]>> {
    return tryCatch(async () => {
      const rows = await db
        .select()
        .from(connectorMessages)
        .where(
          and(
            eq(connectorMessages.channelId, channelId),
            eq(connectorMessages.metaDataId, metaDataId),
            eq(connectorMessages.status, 'QUEUED'),
          ),
        );
      return rows;
    });
  }

  /** Delete all stored content for a message. */
  static async deleteContent(
    channelId: string,
    messageId: number,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      await db
        .delete(messageContent)
        .where(
          and(
            eq(messageContent.channelId, channelId),
            eq(messageContent.messageId, messageId),
          ),
        );
    });
  }

  /** Store a single attachment for a message. */
  static async storeAttachment(
    channelId: string,
    messageId: number,
    attachmentId: string,
    mimeType: string,
    content: string,
    size: number,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      await db
        .insert(messageAttachments)
        .values({
          id: attachmentId,
          channelId,
          messageId,
          mimeType,
          content,
          attachmentSize: size,
        });
    });
  }

  /** Delete all attachments for a message. */
  static async deleteAttachments(
    channelId: string,
    messageId: number,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      await db
        .delete(messageAttachments)
        .where(
          and(
            eq(messageAttachments.channelId, channelId),
            eq(messageAttachments.messageId, messageId),
          ),
        );
    });
  }

  /**
   * Build the content-insert CTE body. Binds each content row's message_id to
   * the new message via `CROSS JOIN new_msg` (not currval), so the id always
   * belongs to this message. The first VALUES row carries explicit casts to fix
   * the column types of the VALUES construct.
   */
  private static buildContentInsert(
    channelId: string,
    contentRows: ReadonlyArray<{ metaDataId: number; contentType: number; content: string; dataType: string }>,
    encrypted: boolean,
  ): ReturnType<typeof sql> {
    const valuesRows = contentRows.map((row, i) =>
      i === 0
        ? sql`(${row.metaDataId}::int, ${row.contentType}::int, ${row.content}::text, ${row.dataType}::text)`
        : sql`(${row.metaDataId}, ${row.contentType}, ${row.content}, ${row.dataType})`,
    );
    return sql`
      INSERT INTO message_content (meta_data_id, content_type, content, data_type, message_id, channel_id, is_encrypted)
      SELECT c.meta_data_id, c.content_type, c.content, c.data_type, new_msg.id, ${channelId}, ${encrypted}
      FROM new_msg
      CROSS JOIN (VALUES ${sql.join(valuesRows, sql`, `)}) AS c(meta_data_id, content_type, content, data_type)
    `;
  }

  /**
   * Batch: create message + source connector + received stat (+ optional content rows)
   * in one round-trip. Uses a single CTE query to minimize latency.
   *
   * The message, source connector, and received-stat rows are ALWAYS written,
   * regardless of the channel's storage mode. Only the content rows are subject
   * to the storage policy: when `contentRows` is empty the content INSERT is
   * skipped entirely (an empty VALUES list is invalid SQL and, previously, threw
   * — silently losing the whole message in PRODUCTION/METADATA/DISABLED modes).
   *
   * `encrypted` marks the content rows as encrypted (is_encrypted = true). The
   * caller (message store adapter) is responsible for having already encrypted
   * each row's content when the channel has encryptData enabled.
   */
  static async initializeMessage(
    channelId: string,
    serverId: string,
    connectorName: string,
    contentRows: ReadonlyArray<{ metaDataId: number; contentType: number; content: string; dataType: string }>,
    correlationId?: string,
    encrypted = false,
  ): Promise<Result<{ messageId: number; correlationId: string }>> {
    return tryCatch(async () => {
      const correlationInsert = correlationId
        ? sql`INSERT INTO messages (channel_id, server_id, correlation_id) VALUES (${channelId}, ${serverId}, ${correlationId})`
        : sql`INSERT INTO messages (channel_id, server_id) VALUES (${channelId}, ${serverId})`;

      // Content is inserted via a CTE that binds message_id to THIS message's id
      // (new_msg.id) rather than currval() — currval on a pooled connection can
      // read a previous message's id and misattribute PHI content.
      const contentCte = contentRows.length > 0
        ? sql`, new_content AS (${MessageService.buildContentInsert(channelId, contentRows, encrypted)})`
        : sql``;

      const result = await db.execute<{ message_id: number; correlation_id: string }>(sql`
        WITH new_msg AS (
          ${correlationInsert}
          RETURNING id, correlation_id
        ),
        new_connector AS (
          INSERT INTO connector_messages (channel_id, message_id, meta_data_id, connector_name, status)
          SELECT ${channelId}, id, 0, ${connectorName}, 'RECEIVED' FROM new_msg
        ),
        new_stats AS (
          INSERT INTO message_statistics (channel_id, meta_data_id, server_id, received, received_lifetime)
          VALUES (${channelId}, 0, ${serverId}, 1, 1)
          ON CONFLICT (channel_id, meta_data_id, server_id)
          DO UPDATE SET
            received = message_statistics.received + 1,
            received_lifetime = message_statistics.received_lifetime + 1
        )${contentCte}
        SELECT id AS message_id, correlation_id FROM new_msg
      `);

      const messageId = result.rows[0]!.message_id;
      const resolvedCorrelationId = result.rows[0]!.correlation_id;

      emitToRoom(`channel:${channelId}`, SOCKET_EVENT.MESSAGE_NEW, { channelId, messageId, metaDataId: 0 });
      emitToRoom('dashboard', SOCKET_EVENT.STATS_UPDATE, { channelId, metaDataId: 0, serverId, field: 'received' });

      return { messageId, correlationId: resolvedCorrelationId };
    });
  }

  /**
   * Batch: set source SENT + increment sent stat + mark processed in one round-trip.
   */
  static async finalizeMessage(
    channelId: string,
    messageId: number,
    serverId: string,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      await db.execute(sql`
        WITH update_connector AS (
          UPDATE connector_messages
          SET status = 'SENT', send_date = NOW()
          WHERE channel_id = ${channelId} AND message_id = ${messageId} AND meta_data_id = 0
        ),
        update_stats AS (
          INSERT INTO message_statistics (channel_id, meta_data_id, server_id, sent, sent_lifetime)
          VALUES (${channelId}, 0, ${serverId}, 1, 1)
          ON CONFLICT (channel_id, meta_data_id, server_id)
          DO UPDATE SET
            sent = message_statistics.sent + 1,
            sent_lifetime = message_statistics.sent_lifetime + 1
        )
        UPDATE messages
        SET processed = true, processed_at = NOW()
        WHERE channel_id = ${channelId} AND id = ${messageId}
      `);

      emitToRoom('dashboard', SOCKET_EVENT.STATS_UPDATE, { channelId, metaDataId: 0, serverId, field: 'sent' });
    });
  }
}
