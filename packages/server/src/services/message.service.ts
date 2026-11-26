import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, sql, gt, inArray, lte, asc, max, not, type SQL } from 'drizzle-orm';
import { CONTENT_TYPE, SOCKET_EVENT, type ContentType, type MessageStatus } from '@galvanigraph/core-models';
import { db } from '../lib/db.js';
import { emitToRoomCoalesced } from '../lib/socket.js';
import { decryptIfEncrypted } from '../lib/content-crypto.js';
import { ServiceError } from '../lib/service-error.js';
import type { HandOff } from '@galvanigraph/engine';
import {
  messages,
  connectorMessages,
  messageContent,
  messageAttachments,
  messageStatistics,
  messageCustomMetadata,
  type ConnectorMessage,
  type Message,
  type MessageStatistic,
} from '../db/schema/index.js';

export interface CreateMessageResult {
  readonly messageId: number;
  readonly correlationId: string;
}

export interface ChannelStatistics {
  readonly channelId: string;
  readonly entries: readonly MessageStatistic[];
}

export interface WaitingMessages {
  readonly metaDataId: number;
  readonly waiting: number;
  /** Those of them that are not known to be for the destination. */
  readonly notKnown: number;
}

type StatField = 'received' | 'filtered' | 'sent' | 'errored';

// Both events are coalesced per room (D-306): listeners only refetch, so the payload
// carries only what stays true for every event a window collapses.

function emitMessageNew(channelId: string): void {
  emitToRoomCoalesced(`channel:${channelId}`, SOCKET_EVENT.MESSAGE_NEW, { channelId });
}

function emitStatsUpdate(): void {
  emitToRoomCoalesced('dashboard', SOCKET_EVENT.STATS_UPDATE, {});
}

/**
 * Whether a `connector_messages` row is for the destination that has its number now; see `OldNumbers`.
 * Not true when that is not known.
 */
function isForItsNumber(channelId: string): SQL {
  const old = sql`(SELECT old_numbers FROM channels WHERE id = ${channelId})`;
  return sql`(connector_messages.number_kept AND connector_messages.message_id > COALESCE((${old} ->> 'upTo')::bigint, 0)
    OR connector_messages.connector_name = ${old} -> 'names' ->> connector_messages.meta_data_id::text)`;
}

/** Locks its connectors. Throws unless the message is open and nothing has been sent. */
async function lockUnrouted(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], channelId: string, messageId: number): Promise<CreateMessageResult> {
  const [source, ...destinations] = await tx.select({ metaDataId: connectorMessages.metaDataId, status: connectorMessages.status })
    .from(connectorMessages).where(and(eq(connectorMessages.channelId, channelId), eq(connectorMessages.messageId, messageId)))
    .orderBy(asc(connectorMessages.metaDataId)).for('update');
  const [message] = await tx.select({ messageId: messages.id, correlationId: messages.correlationId }).from(messages)
    .where(and(eq(messages.channelId, channelId), eq(messages.id, messageId), eq(messages.processed, false)));
  // A source is TRANSFORMED once its destinations are recorded, and they are sent to only after that.
  const unrouted = source?.metaDataId === 0 && (source.status === 'RECEIVED'
    ? destinations.every((d) => d.status === 'RECEIVED')
    : source.status === 'TRANSFORMED' && destinations.length === 0);
  if (!unrouted || message === undefined) {
    throw new ServiceError('CONFLICT', `Message ${String(messageId)} cannot be run again: it has been routed, finished or deleted`);
  }
  return message;
}

function mustBeThere(updated: readonly unknown[], messageId: number, metaDataId: number): void {
  if (updated.length > 0) return;
  throw new ServiceError('NOT_FOUND', `Message ${String(messageId)} is no longer stored for connector ${String(metaDataId)}`);
}

export class MessageService {
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

  /** metaDataId 0 is the source; destinations are 1 and up. */
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

      emitMessageNew(channelId);
    });
  }

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
      const updated = await db
        .update(connectorMessages)
        .set(updates)
        .where(
          and(
            eq(connectorMessages.channelId, channelId),
            eq(connectorMessages.messageId, messageId),
            eq(connectorMessages.metaDataId, metaDataId),
          ),
        )
        .returning({ messageId: connectorMessages.messageId });
      mustBeThere(updated, messageId, metaDataId);
    });
  }

  /**
   * One row per connector message and content type. Storing a type again replaces it (a
   * response after a queued retry, a later error), so the newer content is not lost to a
   * primary-key failure.
   */
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
      }).onConflictDoUpdate({
        target: [messageContent.channelId, messageContent.messageId, messageContent.metaDataId, messageContent.contentType],
        set: { content, dataType, isEncrypted: encrypted ?? false },
      });
    });
  }

  /** Nothing to remove is a success. */
  static async removeContent(
    channelId: string,
    messageId: number,
    metaDataId: number,
    contentType: ContentType,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      await db.delete(messageContent).where(and(
        eq(messageContent.channelId, channelId),
        eq(messageContent.messageId, messageId),
        eq(messageContent.metaDataId, metaDataId),
        eq(messageContent.contentType, contentType),
      ));
    });
  }

  /** Whether a message is finished and its source's status, or null when there is no such message. */
  static async sourceState(
    channelId: string,
    messageId: number,
  ): Promise<Result<{ readonly processed: boolean; readonly status: string | null } | null>> {
    return tryCatch(async () => {
      const [row] = await db
        .select({ processed: messages.processed, status: connectorMessages.status })
        .from(messages)
        .leftJoin(connectorMessages, and(
          eq(connectorMessages.channelId, messages.channelId),
          eq(connectorMessages.messageId, messages.id),
          eq(connectorMessages.metaDataId, 0),
        ))
        .where(and(eq(messages.channelId, channelId), eq(messages.id, messageId)));
      return row ?? null;
    });
  }

  static async storeCustomMetadata(
    channelId: string,
    messageId: number,
    metaDataId: number,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      await db.insert(messageCustomMetadata).values({
        channelId, messageId, metaDataId, metadata: { ...metadata },
      }).onConflictDoUpdate({
        target: [messageCustomMetadata.channelId, messageCustomMetadata.messageId, messageCustomMetadata.metaDataId],
        set: { metadata: { ...metadata } },
      });
    });
  }

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

  static async enqueue(
    channelId: string,
    messageId: number,
    metaDataId: number,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const queued = await db
        .update(connectorMessages)
        .set({ status: 'QUEUED' })
        .where(
          and(
            eq(connectorMessages.channelId, channelId),
            eq(connectorMessages.messageId, messageId),
            eq(connectorMessages.metaDataId, metaDataId),
          ),
        )
        .returning({ messageId: connectorMessages.messageId });
      mustBeThere(queued, messageId, metaDataId);
    });
  }

  /**
   * Rows go QUEUED to PENDING in the same statement, so a concurrent poll cannot dequeue an
   * in-flight message and dispatch it twice. One that is not known to be for the destination stays
   * on the queue. SKIP LOCKED lets consumers claim disjoint batches
   * without blocking each other. Columns are aliased to camelCase so the rows match the
   * QueuedMessage shape the consumer reads.
   */
  static async dequeue(
    channelId: string,
    metaDataId: number,
    batchSize: number,
    rotate = false,
  ): Promise<Result<readonly ConnectorMessage[]>> {
    return tryCatch(async () => {
      // Rotating queues take the least-attempted messages first, so one that
      // keeps failing sinks behind messages that have not been tried yet.
      const order = rotate ? sql`send_attempts ASC, message_id ASC` : sql`message_id ASC`;
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
            AND ${isForItsNumber(channelId)}
          ORDER BY ${order}
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
   * PENDING rows are claimed but unfinished dispatches. After a crash or restart no consumer
   * owns them, so they must be re-queued: a message must never be silently lost.
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

      emitStatsUpdate();
    });
  }

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

      // Plaintext (older rows, channels without encryption) passes through unchanged.
      const decrypted = decryptIfEncrypted(row?.content ?? null);
      if (!decrypted.ok) throw decrypted.error;
      return decrypted.value;
    });
  }

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

  /**
   * Taken at deploy, before the channel starts, it marks which messages are left over from an
   * earlier run and so are safe to recover.
   */
  static async getLatestMessageId(channelId: string): Promise<Result<number>> {
    return tryCatch(async () => {
      const [row] = await db
        .select({ latest: max(messages.id) })
        .from(messages)
        .where(eq(messages.channelId, channelId));
      return row?.latest ?? 0;
    });
  }

  /**
   * `range.maxId` is getLatestMessageId at deploy, so messages the running channel is still
   * working on are never returned.
   */
  static async getUnprocessedMessages(
    channelId: string,
    range: { readonly afterId: number; readonly maxId: number },
    limit: number,
  ): Promise<Result<readonly Message[]>> {
    return tryCatch(async () => {
      const rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.channelId, channelId),
            eq(messages.processed, false),
            gt(messages.id, range.afterId),
            lte(messages.id, range.maxId),
          ),
        )
        .orderBy(asc(messages.id))
        .limit(limit);
      return rows;
    });
  }

  static async getConnectorMessages(
    channelId: string,
    messageId: number,
  ): Promise<Result<readonly { messageId: number; metaDataId: number; status: string; connectorName: string | null }[]>> {
    return tryCatch(async () => {
      const rows = await db
        .select({
          messageId: connectorMessages.messageId,
          metaDataId: connectorMessages.metaDataId,
          status: connectorMessages.status,
          connectorName: connectorMessages.connectorName,
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

  /**
   * Finishes as ERROR a message that stopped before it was routed and cannot be run again. Refused once it
   * was routed, and for a message that is finished or gone. Its custom metadata stays: in a storage mode
   * that keeps no content nothing else says which message it was.
   */
  static async failUnrouted(channelId: string, messageId: number): Promise<Result<void>> {
    return tryCatch(() => db.transaction(async (tx) => {
      await lockUnrouted(tx, channelId, messageId);
      const connectors = and(eq(connectorMessages.channelId, channelId), eq(connectorMessages.messageId, messageId));
      await tx.delete(connectorMessages).where(and(connectors, gt(connectorMessages.metaDataId, 0)));
      await tx.update(connectorMessages).set({ status: 'ERROR' }).where(connectors);
      await tx.update(messages).set({ processed: true, processedAt: new Date() }).where(and(eq(messages.channelId, channelId), eq(messages.id, messageId)));
    }));
  }

  /**
   * Puts a message that stopped before it was routed back as it was when it was received, so
   * running it again cannot leave a second message to deliver. Refused once it was routed, and
   * for a message that is finished or gone. Locks its connectors first, as a message's deletion does.
   */
  static async resetToReceived(channelId: string, messageId: number): Promise<Result<CreateMessageResult>> {
    return tryCatch(() => db.transaction(async (tx) => {
      const ofMessage = <T extends typeof messageCustomMetadata | typeof messageContent | typeof connectorMessages>(table: T) =>
        and(eq(table.channelId, channelId), eq(table.messageId, messageId));
      const message = await lockUnrouted(tx, channelId, messageId);
      await tx.delete(messageCustomMetadata).where(ofMessage(messageCustomMetadata));
      const received = and(eq(messageContent.metaDataId, 0), inArray(messageContent.contentType, [CONTENT_TYPE.RAW, CONTENT_TYPE.SOURCE_MAP]));
      await tx.delete(messageContent).where(and(ofMessage(messageContent), not(received!)));
      await tx.delete(connectorMessages).where(and(ofMessage(connectorMessages), gt(connectorMessages.metaDataId, 0)));
      await tx.update(connectorMessages).set({ status: 'RECEIVED' }).where(and(ofMessage(connectorMessages), eq(connectorMessages.metaDataId, 0)));
      return message;
    }));
  }

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

  static async isForItsNumber(channelId: string, messageId: number, metaDataId: number): Promise<Result<boolean>> {
    return tryCatch(async () => {
      const [row] = await db
        .select({ its: sql<boolean | null>`${isForItsNumber(channelId)}` })
        .from(connectorMessages)
        .where(and(
          eq(connectorMessages.channelId, channelId),
          eq(connectorMessages.messageId, messageId),
          eq(connectorMessages.metaDataId, metaDataId),
        ));
      return row?.its === true;
    });
  }

  /**
   * The messages on the queue of each destination, whether the channel still has it or not. Steps from
   * one number to the next: the index starts with channel and number, so counting by status alone
   * would read every message of the channel.
   */
  static async waitingByDestination(channelId: string, reader: Pick<typeof db, 'execute'> = db): Promise<Result<readonly WaitingMessages[]>> {
    return tryCatch(async () => {
      const next = (after: SQL): SQL => sql`SELECT min(meta_data_id) FROM connector_messages WHERE channel_id = ${channelId} AND meta_data_id > ${after}`;
      const { rows } = await reader.execute<{ metaDataId: number; waiting: number; notKnown: number }>(sql`
        WITH RECURSIVE numbers(n) AS (
          (${next(sql`0`)})
          UNION ALL
          SELECT (${next(sql`numbers.n`)}) FROM numbers WHERE numbers.n IS NOT NULL
        )
        SELECT n AS "metaDataId", queue.waiting, queue."notKnown"
        FROM numbers CROSS JOIN LATERAL (
          SELECT count(*)::int AS waiting, (count(*) FILTER (WHERE ${isForItsNumber(channelId)} IS NOT TRUE))::int AS "notKnown"
          FROM connector_messages
          WHERE channel_id = ${channelId} AND meta_data_id = n AND status IN ('QUEUED', 'PENDING')
        ) AS queue
        WHERE queue.waiting > 0
      `);
      return rows;
    });
  }

  static async isFullyDelivered(channelId: string, messageId: number): Promise<Result<boolean>> {
    return tryCatch(async () => {
      const [row] = await db
        .select({
          total: sql<number>`count(*)::int`,
          unfinished: sql<number>`count(*) filter (where ${connectorMessages.status} not in ('SENT', 'FILTERED'))::int`,
        })
        .from(connectorMessages)
        .where(and(eq(connectorMessages.channelId, channelId), eq(connectorMessages.messageId, messageId)));
      return row !== undefined && row.total > 0 && row.unfinished === 0;
    });
  }

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

  /** The first VALUES row carries explicit casts to fix the column types of the VALUES construct. */
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
   * The message, source connector and received-stat rows are always written, whatever the
   * storage mode; only content rows follow the storage policy. An empty `contentRows` skips the
   * content insert: an empty VALUES list is invalid SQL and would lose the whole message.
   *
   * `encrypted` only marks the rows; the caller must already have encrypted each row's content.
   * `handOff` is the Channel Writer send the message comes from: the same statement records the
   * message on the sender's message, so a send a server stop interrupts can tell it was recorded (D-403).
   */
  static async initializeMessage(
    channelId: string,
    serverId: string,
    connectorName: string,
    contentRows: ReadonlyArray<{ metaDataId: number; contentType: number; content: string; dataType: string }>,
    correlationId?: string,
    { encrypted = false, handOff }: { readonly encrypted?: boolean; readonly handOff?: HandOff | undefined } = {},
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
      // A row an earlier send left is replaced: that send never returned, and this message is the one the next one asks about.
      const handOffCte = handOff
        ? sql`, hand_off AS (
            INSERT INTO message_content (channel_id, message_id, meta_data_id, content_type, content, data_type, is_encrypted)
            SELECT ${handOff.channelId}, ${handOff.messageId}, ${handOff.metaDataId}, ${CONTENT_TYPE.HAND_OFF},
              json_build_object('channelId', ${channelId}::text, 'messageId', new_msg.id)::text, 'JSON', false
            FROM new_msg
            ON CONFLICT (channel_id, message_id, meta_data_id, content_type) DO UPDATE SET content = EXCLUDED.content
          )`
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
        )${contentCte}${handOffCte}
        SELECT id AS message_id, correlation_id FROM new_msg
      `);

      const messageId = result.rows[0]!.message_id;
      const resolvedCorrelationId = result.rows[0]!.correlation_id;

      emitMessageNew(channelId);
      emitStatsUpdate();

      return { messageId, correlationId: resolvedCorrelationId };
    });
  }

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

      emitStatsUpdate();
    });
  }
}
