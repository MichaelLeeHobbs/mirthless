import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, inArray } from 'drizzle-orm';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { messageContent, messages, connectorMessages } from '../db/schema/index.js';
import { decryptIfEncrypted } from '../lib/content-crypto.js';
import { deleteMessagesByIds } from './message-delete-helper.js';
import { MessageService } from './message.service.js';
import { getEngine } from '../engine.js';

export interface ReprocessResult {
  readonly messageId: number;
  readonly newMessageId: number;
}

export interface BulkDeleteResult {
  readonly deletedCount: number;
}

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
  /** Not sent yet: the queue consumer redispatches on its next poll. */
  readonly status: 'QUEUED';
}

async function hasStoredVariables(channelId: string, messageId: number, metaDataId: number): Promise<boolean> {
  const rows = await db
    .select({ contentType: messageContent.contentType })
    .from(messageContent)
    .where(and(
      eq(messageContent.channelId, channelId),
      eq(messageContent.messageId, messageId),
      eq(messageContent.metaDataId, metaDataId),
      eq(messageContent.contentType, CONTENT_TYPE.CHANNEL_MAP),
    ));
  return rows.length > 0;
}

async function isProcessed(channelId: string, messageId: number): Promise<boolean> {
  const [row] = await db.select({ processed: messages.processed }).from(messages)
    .where(and(eq(messages.channelId, channelId), eq(messages.id, messageId)));
  return row?.processed === true;
}

export class MessageReprocessService {
  /** Re-injects the stored raw source as a new message. */
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
        throw new ServiceError('NOT_FOUND', `Raw content not found for message ${String(messageId)}. Reprocess requires stored raw content (DEVELOPMENT, PRODUCTION or RAW storage mode).`);
      }

      const decrypted = decryptIfEncrypted(row.content);
      if (!decrypted.ok) throw decrypted.error;
      const rawContent = decrypted.value ?? '';

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

  /** A failing message is recorded in its result and does not abort the batch. */
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
   * Re-queues one destination; no other is touched. A NEVER-queue destination has no
   * consumer, so re-queuing would strand the message: refused. So is one that uses variables
   * of a message routed when it did not queue, because they were not kept (#390), and one whose
   * first send may be under way, which the queue would send beside it (#416).
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

      if (!dest.enabled) {
        throw new ServiceError('CONFLICT', `Destination "${dest.name}" is switched off.`);
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
      if (cm.status === 'RECEIVED' && !(await isProcessed(channelId, messageId))) {
        throw new ServiceError('CONFLICT', `Message ${String(messageId)} is still being sent to "${dest.name}", or crash recovery is about to. Wait until it has ended.`);
      }
      const its = await MessageService.isForItsNumber(channelId, messageId, metaDataId);
      if (!its.ok) throw its.error;
      if (!its.value) {
        throw new ServiceError('CONFLICT', `Message ${String(messageId)} cannot be resent: it is from before destinations kept their numbers, and it is not known to be for "${dest.name}". Reprocess the whole message instead.`);
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
      const decrypted = decryptIfEncrypted(content.content);
      if (!decrypted.ok) throw decrypted.error;
      const used = deployed.variablesUsed(metaDataId, messageId, decrypted.value ?? '');
      if (used.length > 0 && !(await hasStoredVariables(channelId, messageId, metaDataId))) {
        throw new ServiceError('CONFLICT', `Destination ${String(metaDataId)} uses the message's variables (${used.join(', ')}), and none are stored for message ${String(messageId)}; a resend would go without them. Reprocess the whole message instead.`);
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

      const existing = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.channelId, channelId),
            inArray(messages.id, ids),
          ),
        );

      if (existing.length === 0) {
        throw new ServiceError('NOT_FOUND', 'No matching messages found');
      }

      const existingIds = existing.map((m) => m.id);

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
