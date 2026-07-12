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
import { getEngine } from '../engine.js';

// ----- Response Types -----

export interface ReprocessResult {
  /** The original message that was reprocessed. */
  readonly messageId: number;
  /** The new message produced by re-injecting the raw content through the pipeline. */
  readonly newMessageId: number;
}

export interface BulkDeleteResult {
  readonly deletedCount: number;
}

// ----- Service -----

export class MessageReprocessService {
  /**
   * Reprocess a message by re-injecting its stored raw source content through the
   * deployed channel's pipeline as a new message. The channel must be deployed and
   * STARTED. Returns the original and newly-produced message ids.
   */
  static async reprocessMessage(
    channelId: string,
    messageId: number,
    context?: AuditContext,
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
        throw new ServiceError('NOT_FOUND', `Raw content not found for message ${String(messageId)}. Reprocess requires stored raw content (DEVELOPMENT/RAW storage mode).`);
      }

      // Re-inject the raw content through the deployed channel's pipeline.
      const deployed = getEngine().getRuntime(channelId);
      if (!deployed) {
        throw new ServiceError('CONFLICT', `Channel ${channelId} is not deployed; deploy and start it to reprocess.`);
      }
      const state = deployed.runtime.getState();
      if (state !== 'STARTED') {
        throw new ServiceError('CONFLICT', `Channel is ${state}, must be STARTED to reprocess a message.`);
      }

      const injected = await deployed.processMessage(row.content, { reprocessedFrom: messageId });
      if (!injected.ok) {
        throw new ServiceError('INTERNAL', injected.error.message);
      }

      emitEvent({
        level: 'INFO', name: 'MESSAGE_REPROCESSED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { originalMessageId: messageId, newMessageId: injected.value.messageId },
      });

      return { messageId, newMessageId: injected.value.messageId };
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
