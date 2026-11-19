import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, sql } from 'drizzle-orm';
import type { MessageSearchQuery } from '@galvanigraph/core-models';
import { db } from '../lib/db.js';
import { ServiceError } from '../lib/service-error.js';
import { decryptIfEncrypted } from '../lib/content-crypto.js';
import { deleteMessagesByIds } from './message-delete-helper.js';
import { containsPattern } from '../lib/like.js';
import {
  messages,
  connectorMessages,
  messageContent,
} from '../db/schema/index.js';

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
  /** Custom metadata of the source connector only. */
  readonly metaData: Readonly<Record<string, unknown>>;
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

export class MessageQueryService {
  static async searchMessages(
    channelId: string,
    filters: MessageSearchQuery,
  ): Promise<Result<MessageSearchResult>> {
    return tryCatch(async () => {
      const conditions = [eq(messages.channelId, channelId)];

      if (filters.messageId !== undefined) {
        conditions.push(eq(messages.id, filters.messageId));
      }
      if (filters.receivedFrom !== undefined) {
        conditions.push(sql`${messages.receivedAt} >= ${filters.receivedFrom.toISOString()}`);
      }
      if (filters.receivedTo !== undefined) {
        conditions.push(sql`${messages.receivedAt} <= ${filters.receivedTo.toISOString()}`);
      }

      const hasConnectorFilter = (filters.status !== undefined && filters.status.length > 0) || filters.metaDataId !== undefined;
      const hasContentSearch = filters.contentSearch !== undefined && filters.contentSearch.length > 0;

      if (hasConnectorFilter) {
        const cmConditions = [sql`cm.channel_id = ${channelId}`];
        if (filters.status !== undefined && filters.status.length > 0) {
          cmConditions.push(sql`cm.status IN (${sql.join(filters.status.map(s => sql`${s}`), sql`, `)})`);
        }
        if (filters.metaDataId !== undefined) {
          cmConditions.push(sql`cm.meta_data_id = ${filters.metaDataId}`);
        }
        const cmWhere = sql.join(cmConditions, sql` AND `);
        conditions.push(sql`${messages.id} IN (SELECT DISTINCT cm.message_id FROM connector_messages cm WHERE ${cmWhere})`);
      }

      if (hasContentSearch) {
        const searchTerm = containsPattern(filters.contentSearch!);
        conditions.push(
          sql`${messages.id} IN (SELECT DISTINCT mc.message_id FROM message_content mc WHERE mc.channel_id = ${channelId} AND mc.content ILIKE ${searchTerm})`
        );
      }

      if (filters.metaDataColumn !== undefined) {
        const match = filters.metaDataValue === undefined
          ? sql`mcm.metadata ? ${filters.metaDataColumn}`
          : sql`mcm.metadata ->> ${filters.metaDataColumn} = ${filters.metaDataValue}`;
        conditions.push(
          sql`${messages.id} IN (SELECT mcm.message_id FROM message_custom_metadata mcm WHERE mcm.channel_id = ${channelId} AND mcm.meta_data_id = 0 AND ${match})`,
        );
      }

      const whereClause = and(...conditions);

      const countResult = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*) as count FROM messages WHERE ${whereClause}`
      );
      const total = Number(countResult.rows[0]?.count ?? 0);

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

      // Raw SQL IN list avoids Drizzle bigint/number coercion issues.
      const messageIds = messageRows.rows.map(r => Number(r.id));
      const idParams = messageIds.map((id) => sql`${id}`);
      const connectorRows = await db.execute<{
        message_id: number;
        meta_data_id: number;
        connector_name: string | null;
        status: string;
        send_attempts: number;
      }>(sql`
        SELECT message_id, meta_data_id, connector_name, status, send_attempts
        FROM connector_messages
        WHERE channel_id = ${channelId}
          AND message_id IN (${sql.join(idParams, sql`, `)})
      `);

      const connectorMap = new Map<number, ConnectorSummary[]>();
      for (const row of connectorRows.rows) {
        const msgId = Number(row.message_id);
        const existing = connectorMap.get(msgId);
        const entry: ConnectorSummary = {
          metaDataId: row.meta_data_id,
          connectorName: row.connector_name,
          status: row.status,
          sendAttempts: row.send_attempts,
        };
        if (existing) {
          existing.push(entry);
        } else {
          connectorMap.set(msgId, [entry]);
        }
      }

      const metaDataRows = await db.execute<{ message_id: number; metadata: Record<string, unknown> }>(sql`
        SELECT message_id, metadata
        FROM message_custom_metadata
        WHERE channel_id = ${channelId}
          AND meta_data_id = 0
          AND message_id IN (${sql.join(idParams, sql`, `)})
      `);
      const metaDataByMessage = new Map(metaDataRows.rows.map((r) => [Number(r.message_id), r.metadata] as const));

      const items: MessageSummary[] = messageRows.rows.map(row => {
        const id = Number(row.id);
        return {
          messageId: id,
          correlationId: row.correlation_id,
          receivedAt: typeof row.received_at === 'string' ? row.received_at : new Date(row.received_at).toISOString(),
          processed: row.processed,
          processedAt: row.processed_at
            ? (typeof row.processed_at === 'string' ? row.processed_at : new Date(row.processed_at).toISOString())
            : null,
          connectors: connectorMap.get(id) ?? [],
          metaData: metaDataByMessage.get(id) ?? {},
        };
      });

      return { items, total, limit: filters.limit, offset: filters.offset };
    });
  }

  static async getMessageDetail(
    channelId: string,
    messageId: number,
  ): Promise<Result<MessageDetail>> {
    return tryCatch(async () => {
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

      const connectorRows = await db
        .select()
        .from(connectorMessages)
        .where(
          and(
            eq(connectorMessages.channelId, channelId),
            eq(connectorMessages.messageId, messageId),
          ),
        );

      const contentRows = await db
        .select()
        .from(messageContent)
        .where(
          and(
            eq(messageContent.channelId, channelId),
            eq(messageContent.messageId, messageId),
          ),
        );

      const contentMap = new Map<number, ConnectorContent>();
      for (const row of contentRows) {
        const typeName = CONTENT_TYPE_NAMES[row.contentType] ?? `type_${String(row.contentType)}`;
        const decrypted = decryptIfEncrypted(row.content ?? null);
        if (!decrypted.ok) throw decrypted.error;
        const value = decrypted.value ?? undefined;
        const existing = contentMap.get(row.metaDataId);
        if (existing) {
          (existing as Record<string, string | undefined>)[typeName] = value;
        } else {
          contentMap.set(row.metaDataId, { [typeName]: value });
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

  static async deleteMessage(
    channelId: string,
    messageId: number,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
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

      // The shared helper is atomic and also removes attachments and custom metadata, which
      // hold PHI that would otherwise outlive the delete.
      await deleteMessagesByIds(channelId, [messageId]);
    });
  }

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
