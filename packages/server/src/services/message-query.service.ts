// ===========================================
// Message Query Service
// ===========================================
// Read-only query service for message search, detail, and deletion.
// Separated from the write-path MessageService used by the engine.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, sql, inArray } from 'drizzle-orm';
import type { MessageSearchQuery } from '@mirthless/core-models';
import { db } from '../lib/db.js';
import { ServiceError } from '../lib/service-error.js';
import {
  messages,
  connectorMessages,
  messageContent,
} from '../db/schema/index.js';

// ----- Response Types -----

export interface ConnectorSummary {
  readonly metaDataId: number;
  readonly connectorName: string | null;
  readonly status: string;
  readonly sendAttempts: number;
}

export interface MessageSummary {
  readonly messageId: number;
  readonly correlationId: string;
  readonly receivedAt: string;
  readonly processed: boolean;
  readonly processedAt: string | null;
  readonly connectors: readonly ConnectorSummary[];
}

export interface MessageSearchResult {
  readonly items: readonly MessageSummary[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface ConnectorContent {
  readonly [key: string]: string | undefined;
}

export interface ConnectorDetail {
  readonly metaDataId: number;
  readonly connectorName: string | null;
  readonly status: string;
  readonly sendAttempts: number;
  readonly content: ConnectorContent;
}

export interface MessageDetail {
  readonly messageId: number;
  readonly correlationId: string;
  readonly receivedAt: string;
  readonly processed: boolean;
  readonly processedAt: string | null;
  readonly serverId: string | null;
  readonly connectors: readonly ConnectorDetail[];
}

export interface MessageCounts {
  readonly total: number;
  readonly processed: number;
  readonly errored: number;
}

// ----- Content Type Name Map -----

const CONTENT_TYPE_NAMES: Record<number, string> = {
  1: 'raw',
  2: 'processed',
  3: 'transformed',
  4: 'encoded',
  5: 'sent',
  6: 'response',
  7: 'responseTransformed',
  8: 'responseSent',
  9: 'sourceMap',
  10: 'channelMap',
  11: 'error',
  12: 'responseError',
  13: 'processingError',
};

// ----- Service -----

export class MessageQueryService {
  /** Search messages with filters, pagination, and sorting. */
  static async searchMessages(
    channelId: string,
    filters: MessageSearchQuery,
  ): Promise<Result<MessageSearchResult>> {
    return tryCatch(async () => {
      const conditions = [eq(messages.channelId, channelId)];

      if (filters.receivedFrom !== undefined) {
        conditions.push(sql`${messages.receivedAt} >= ${filters.receivedFrom.toISOString()}`);
      }
      if (filters.receivedTo !== undefined) {
        conditions.push(sql`${messages.receivedAt} <= ${filters.receivedTo.toISOString()}`);
      }

      // If status or metaDataId or contentSearch are set, we need to join connector_messages / message_content
      const hasConnectorFilter = (filters.status !== undefined && filters.status.length > 0) || filters.metaDataId !== undefined;
      const hasContentSearch = filters.contentSearch !== undefined && filters.contentSearch.length > 0;

      let messageIdSubquery: ReturnType<typeof sql> | null = null;

      if (hasConnectorFilter) {
        const cmConditions = [sql`cm.channel_id = ${channelId}`];
        if (filters.status !== undefined && filters.status.length > 0) {
          cmConditions.push(sql`cm.status IN (${sql.join(filters.status.map(s => sql`${s}`), sql`, `)})`);
        }
        if (filters.metaDataId !== undefined) {
          cmConditions.push(sql`cm.meta_data_id = ${filters.metaDataId}`);
        }
        const cmWhere = sql.join(cmConditions, sql` AND `);
        messageIdSubquery = sql`${messages.id} IN (SELECT DISTINCT cm.message_id FROM connector_messages cm WHERE ${cmWhere})`;
        conditions.push(messageIdSubquery);
      }

      if (hasContentSearch) {
        const searchTerm = `%${filters.contentSearch!}%`;
        conditions.push(
          sql`${messages.id} IN (SELECT DISTINCT mc.message_id FROM message_content mc WHERE mc.channel_id = ${channelId} AND mc.content ILIKE ${searchTerm})`
        );
      }

      const whereClause = and(...conditions);

      // Count total matching
      const countResult = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*) as count FROM messages WHERE ${whereClause}`
      );
      const total = Number(countResult.rows[0]?.count ?? 0);

      // Fetch message rows
      const sortCol = filters.sort === 'messageId' ? 'id' : 'received_at';
      const sortDirection = filters.sortDir === 'asc' ? sql`ASC` : sql`DESC`;

      const messageRows = await db.execute<{
        id: number;
        correlation_id: string;
        received_at: string;
        processed: boolean;
        processed_at: string | null;
      }>(sql`
        SELECT id, correlation_id, received_at, processed, processed_at
        FROM messages
        WHERE ${whereClause}
        ORDER BY ${sql.raw(sortCol)} ${sortDirection}
        LIMIT ${filters.limit}
        OFFSET ${filters.offset}
      `);

      if (messageRows.rows.length === 0) {
        return { items: [], total, limit: filters.limit, offset: filters.offset };
      }

      // Fetch connector messages for all returned message IDs
      // Raw SQL returns bigint as string — coerce to number for Drizzle inArray
      const messageIds = messageRows.rows.map(r => Number(r.id));
      const connectorRows = await db
        .select({
          messageId: connectorMessages.messageId,
          metaDataId: connectorMessages.metaDataId,
          connectorName: connectorMessages.connectorName,
          status: connectorMessages.status,
          sendAttempts: connectorMessages.sendAttempts,
        })
        .from(connectorMessages)
        .where(
          and(
            eq(connectorMessages.channelId, channelId),
            inArray(connectorMessages.messageId, messageIds),
          ),
        );

      // Group connectors by messageId
      const connectorMap = new Map<number, ConnectorSummary[]>();
      for (const row of connectorRows) {
        const existing = connectorMap.get(row.messageId);
        const entry: ConnectorSummary = {
          metaDataId: row.metaDataId,
          connectorName: row.connectorName,
          status: row.status,
          sendAttempts: row.sendAttempts,
        };
        if (existing) {
          existing.push(entry);
        } else {
          connectorMap.set(row.messageId, [entry]);
        }
      }

      const items: MessageSummary[] = messageRows.rows.map(row => ({
        messageId: row.id,
        correlationId: row.correlation_id,
        receivedAt: typeof row.received_at === 'string' ? row.received_at : new Date(row.received_at).toISOString(),
        processed: row.processed,
        processedAt: row.processed_at
          ? (typeof row.processed_at === 'string' ? row.processed_at : new Date(row.processed_at).toISOString())
          : null,
        connectors: connectorMap.get(row.id) ?? [],
      }));

      return { items, total, limit: filters.limit, offset: filters.offset };
    });
  }

  /** Get full message detail with all content for each connector. */
  static async getMessageDetail(
    channelId: string,
    messageId: number,
  ): Promise<Result<MessageDetail>> {
    return tryCatch(async () => {
      // Fetch message
      const [message] = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.channelId, channelId),
            eq(messages.id, messageId),
          ),
        );

      if (!message) {
        throw new ServiceError('NOT_FOUND', `Message not found: ${String(messageId)}`);
      }

      // Fetch all connector messages
      const connectorRows = await db
        .select()
        .from(connectorMessages)
        .where(
          and(
            eq(connectorMessages.channelId, channelId),
            eq(connectorMessages.messageId, messageId),
          ),
        );

      // Fetch all content
      const contentRows = await db
        .select()
        .from(messageContent)
        .where(
          and(
            eq(messageContent.channelId, channelId),
            eq(messageContent.messageId, messageId),
          ),
        );

      // Group content by metaDataId
      const contentMap = new Map<number, ConnectorContent>();
      for (const row of contentRows) {
        const typeName = CONTENT_TYPE_NAMES[row.contentType] ?? `type_${String(row.contentType)}`;
        const existing = contentMap.get(row.metaDataId);
        if (existing) {
          (existing as Record<string, string | undefined>)[typeName] = row.content ?? undefined;
        } else {
          contentMap.set(row.metaDataId, { [typeName]: row.content ?? undefined });
        }
      }

      const connectors: ConnectorDetail[] = connectorRows.map(row => ({
        metaDataId: row.metaDataId,
        connectorName: row.connectorName,
        status: row.status,
        sendAttempts: row.sendAttempts,
        content: contentMap.get(row.metaDataId) ?? {},
      }));

      return {
        messageId: message.id,
        correlationId: message.correlationId,
        receivedAt: message.receivedAt.toISOString(),
        processed: message.processed,
        processedAt: message.processedAt?.toISOString() ?? null,
        serverId: message.serverId,
        connectors,
      };
    });
  }

  /** Delete a message and all related data. */
  static async deleteMessage(
    channelId: string,
    messageId: number,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      // Check message exists
      const [message] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.channelId, channelId),
            eq(messages.id, messageId),
          ),
        );

      if (!message) {
        throw new ServiceError('NOT_FOUND', `Message not found: ${String(messageId)}`);
      }

      // Delete in dependency order: content → connector_messages → messages
      await db.delete(messageContent).where(
        and(
          eq(messageContent.channelId, channelId),
          eq(messageContent.messageId, messageId),
        ),
      );
      await db.delete(connectorMessages).where(
        and(
          eq(connectorMessages.channelId, channelId),
          eq(connectorMessages.messageId, messageId),
        ),
      );
      await db.delete(messages).where(
        and(
          eq(messages.channelId, channelId),
          eq(messages.id, messageId),
        ),
      );
    });
  }

  /** Get message counts for a channel. */
  static async getMessageCounts(
    channelId: string,
  ): Promise<Result<MessageCounts>> {
    return tryCatch(async () => {
      const result = await db.execute<{ total: string; processed: string; errored: string }>(sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE processed = true) as processed,
          (SELECT COUNT(DISTINCT message_id)
           FROM connector_messages
           WHERE channel_id = ${channelId} AND status = 'ERROR') as errored
        FROM messages
        WHERE channel_id = ${channelId}
      `);

      const row = result.rows[0];
      return {
        total: Number(row?.total ?? 0),
        processed: Number(row?.processed ?? 0),
        errored: Number(row?.errored ?? 0),
      };
    });
  }
}
