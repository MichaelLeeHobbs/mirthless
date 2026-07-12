// ===========================================
// Message Reprocess Service
// ===========================================
// Reprocessing and bulk deletion of messages.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, sql } from 'drizzle-orm';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { messageContent, messages, connectorMessages } from '../db/schema/index.js';
import { CONTENT_TYPE } from '../db/schema/message-content.js';
import { decryptIfEncrypted } from '../lib/content-crypto.js';
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

/** Per-message outcome of a bulk reprocess. */
export interface BulkReprocessItemResult {
  readonly messageId: number;
  readonly newMessageId?: number;
  readonly error?: string;
}

export interface BulkReprocessResult {
  readonly requested: number;
  readonly reprocessed: number;
  readonly results: readonly BulkReprocessItemResult[];
}

export interface ResendResult {
  readonly messageId: number;
  readonly metaDataId: number;
  /** The destination was re-queued; the queue consumer redispatches on next poll. */
  readonly status: 'QUEUED';
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

      // Decrypt at-rest encrypted raw content before re-injecting it.
      const decrypted = decryptIfEncrypted(row.content);
      if (!decrypted.ok) throw decrypted.error;
      const rawContent = decrypted.value ?? '';

      // Re-inject the raw content through the deployed channel's pipeline.
      const deployed = getEngine().getRuntime(channelId);
      if (!deployed) {
        throw new ServiceError('CONFLICT', `Channel ${channelId} is not deployed; deploy and start it to reprocess.`);
      }
      const state = deployed.runtime.getState();
      if (state !== 'STARTED') {
        throw new ServiceError('CONFLICT', `Channel is ${state}, must be STARTED to reprocess a message.`);
      }

      const injected = await deployed.processMessage(rawContent, { reprocessedFrom: messageId });
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

  /**
   * Reprocess many messages by re-injecting each one's stored raw content. The
   * channel must be deployed and STARTED (checked once up front — a 409 aborts
   * before any work). Individual message failures are captured per-item and do
   * not abort the batch. Emits one aggregate MESSAGES_REPROCESSED audit event.
   */
  static async bulkReprocess(
    channelId: string,
    messageIds: readonly number[],
    context?: AuditContext,
  ): Promise<Result<BulkReprocessResult>> {
    return tryCatch(async () => {
      const deployed = getEngine().getRuntime(channelId);
      if (!deployed) {
        throw new ServiceError('CONFLICT', `Channel ${channelId} is not deployed; deploy and start it to reprocess.`);
      }
      const state = deployed.runtime.getState();
      if (state !== 'STARTED') {
        throw new ServiceError('CONFLICT', `Channel is ${state}, must be STARTED to reprocess messages.`);
      }

      const results: BulkReprocessItemResult[] = [];
      let reprocessed = 0;
      for (const messageId of messageIds) {
        const r = await MessageReprocessService.reprocessMessage(channelId, messageId, context);
        if (r.ok) {
          reprocessed += 1;
          results.push({ messageId, newMessageId: r.value.newMessageId });
        } else {
          results.push({ messageId, error: r.error.message });
        }
      }

      emitEvent({
        level: 'INFO', name: 'MESSAGES_REPROCESSED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { requested: messageIds.length, reprocessed },
      });

      return { requested: messageIds.length, reprocessed, results };
    });
  }

  /**
   * Resend a single destination connector's stored SENT content in isolation.
   *
   * Re-enqueues exactly one connector message (status → QUEUED, attempts reset)
   * so the channel's already-running queue consumer redispatches it. This is
   * side-effect isolated: no other destination is touched. Only queue-enabled
   * destinations can be resent this way — a NEVER-queue destination has no
   * consumer, so re-enqueuing would strand the message; that case is rejected.
   */
  static async resendDestination(
    channelId: string,
    messageId: number,
    metaDataId: number,
    context?: AuditContext,
  ): Promise<Result<ResendResult>> {
    return tryCatch(async () => {
      const deployed = getEngine().getRuntime(channelId);
      if (!deployed) {
        throw new ServiceError('CONFLICT', `Channel ${channelId} is not deployed; deploy and start it to resend.`);
      }
      const state = deployed.runtime.getState();
      if (state !== 'STARTED') {
        throw new ServiceError('CONFLICT', `Channel is ${state}, must be STARTED to resend a destination.`);
      }

      const dest = deployed.config.destinations.find((d) => d.metaDataId === metaDataId);
      if (!dest) {
        throw new ServiceError('NOT_FOUND', `Destination ${String(metaDataId)} not found on channel ${channelId}.`);
      }
      if (dest.queueMode === 'NEVER') {
        throw new ServiceError('CONFLICT', `Destination ${String(metaDataId)} is not queue-enabled; isolated resend requires queuing. Reprocess the whole message instead.`);
      }

      const [cm] = await db
        .select({ status: connectorMessages.status })
        .from(connectorMessages)
        .where(and(
          eq(connectorMessages.channelId, channelId),
          eq(connectorMessages.messageId, messageId),
          eq(connectorMessages.metaDataId, metaDataId),
        ));
      if (!cm) {
        throw new ServiceError('NOT_FOUND', `No connector message for message ${String(messageId)} destination ${String(metaDataId)}.`);
      }

      const [content] = await db
        .select({ content: messageContent.content })
        .from(messageContent)
        .where(and(
          eq(messageContent.channelId, channelId),
          eq(messageContent.messageId, messageId),
          eq(messageContent.metaDataId, metaDataId),
          eq(messageContent.contentType, CONTENT_TYPE.SENT),
        ));
      if (!content?.content) {
        throw new ServiceError('CONFLICT', `No stored sent content for message ${String(messageId)} destination ${String(metaDataId)}; cannot resend.`);
      }

      // Re-enqueue with a fresh retry budget; the running consumer picks it up.
      await db
        .update(connectorMessages)
        .set({ status: 'QUEUED', sendAttempts: 0 })
        .where(and(
          eq(connectorMessages.channelId, channelId),
          eq(connectorMessages.messageId, messageId),
          eq(connectorMessages.metaDataId, metaDataId),
        ));

      emitEvent({
        level: 'INFO', name: 'MESSAGE_RESEND_QUEUED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { messageId, metaDataId },
      });

      return { messageId, metaDataId, status: 'QUEUED' as const };
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
