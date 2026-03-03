// ===========================================
// Message Reprocess Service
// ===========================================
// Reprocessing and bulk deletion of messages.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, sql } from 'drizzle-orm';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { messageContent, messages } from '../db/schema/index.js';
import { CONTENT_TYPE } from '../db/schema/message-content.js';
import { deleteMessagesByIds } from './message-delete-helper.js';

// ----- Response Types -----

export interface ReprocessResult {
  readonly messageId: number;
  readonly rawContent: string;
}

export interface BulkDeleteResult {
  readonly deletedCount: number;
}

// ----- Service -----

export class MessageReprocessService {
  /** Read raw content for a message to allow reprocessing. */
  static async reprocessMessage(
    channelId: string,
    messageId: number,
  ): Promise<Result<ReprocessResult>> {
    return tryCatch(async () => {
      const [row] = await db
        .select({ content: messageContent.content })
        .from(messageContent)
        .where(
          and(
            eq(messageContent.channelId, channelId),
            eq(messageContent.messageId, messageId),
            eq(messageContent.metaDataId, 0),
            eq(messageContent.contentType, CONTENT_TYPE.RAW),
          ),
        );

      if (!row?.content) {
        throw new ServiceError('NOT_FOUND', `Raw content not found for message ${String(messageId)}`);
      }

      return { messageId, rawContent: row.content };
    });
  }

  /** Bulk delete messages by IDs using dependency-order deletion. */
  static async bulkDelete(
    channelId: string,
    messageIds: readonly number[],
    context?: AuditContext,
  ): Promise<Result<BulkDeleteResult>> {
    return tryCatch(async () => {
      if (messageIds.length === 0) {
        return { deletedCount: 0 };
      }

      const ids = [...messageIds];

      // Verify messages exist
      const existing = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.channelId, channelId),
            sql`id = ANY(${ids})`,
          ),
        );

      if (existing.length === 0) {
        throw new ServiceError('NOT_FOUND', 'No matching messages found');
      }

      const existingIds = existing.map((m) => m.id);

      // Delete in dependency order (transactional)
      await deleteMessagesByIds(channelId, existingIds);

      emitEvent({
        level: 'INFO', name: 'MESSAGES_DELETED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { deletedCount: existingIds.length },
      });

      return { deletedCount: existingIds.length };
    });
  }
}
