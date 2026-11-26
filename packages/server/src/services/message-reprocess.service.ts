import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, sql } from 'drizzle-orm';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { whyNotTaking } from '../lib/taking-messages.js';
import { db } from '../lib/db.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { messageContent, connectorMessages } from '../db/schema/index.js';
import { decryptIfEncrypted } from '../lib/content-crypto.js';
import { deleteMessagesByIds, type DeletedMessages } from './message-delete-helper.js';
import { MessageService } from './message.service.js';
import { getEngine } from '../engine.js';

export interface ReprocessResult {
  readonly messageId: number;
  readonly newMessageId: number;
}

export interface BulkDeleteResult {
  readonly deletedCount: number;
  /** Not deleted: something may be working on them. */
  readonly refusedIds: readonly number[];
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

/**
 * A message that is not finished can be deleted only while nothing here works on the channel's messages: what
 * is stored for it afterwards would outlive it. One that waits on a queue can, which takes it off the queue.
 */
async function deleteUnused(channelId: string, messageIds: readonly number[]): Promise<DeletedMessages> {
  const result = await deleteMessagesByIds(channelId, messageIds, { unfinished: () => getEngine().isAtRest(channelId), queued: true });
  if (result.deletedIds.length > 0) return result;
  if (result.refusedIds.length === 0) throw new ServiceError('NOT_FOUND', 'No matching messages found');
  const what = result.refusedIds.length === 1 ? `Message ${String(result.refusedIds[0])} was not deleted: it is` : `${String(result.refusedIds.length)} messages were not deleted: they are`;
  throw new ServiceError('CONFLICT', `${what} still being processed or sent. Try again once that has ended. If it does not end, stop the channel first.`);
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
      const why = whyNotTaking(deployed.runtime);
      if (why !== null) {
        throw new ServiceError('CONFLICT', `Channel is ${why}, must be STARTED to reprocess a message.`);
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
      const why = whyNotTaking(deployed.runtime);
      if (why !== null) {
        throw new ServiceError('CONFLICT', `Channel is ${why}, must be STARTED to reprocess messages.`);
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
   * of a message routed when it did not queue, because they were not kept (#390), one whose
   * first send may be under way, which the queue would send beside it (#416), and one that its queue
   * has claimed, whose row would read QUEUED while it is being sent (#403).
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
        .select({
          status: connectorMessages.status,
          // With the status, in one statement: read after it, a send that ended in between would look like none.
          open: sql<boolean>`EXISTS (SELECT 1 FROM messages m WHERE m.channel_id = ${channelId} AND m.id = ${messageId} AND NOT m.processed)`,
        })
        .from(connectorMessages)
        .where(and(
          eq(connectorMessages.channelId, channelId),
          eq(connectorMessages.messageId, messageId),
          eq(connectorMessages.metaDataId, metaDataId),
        ));
      if (!cm) {
        throw new ServiceError('NOT_FOUND', `No connector message for message ${String(messageId)} destination ${String(metaDataId)}.`);
      }
      if (cm.status === 'RECEIVED' && cm.open) {
        throw new ServiceError('CONFLICT', `Message ${String(messageId)} is still being sent to "${dest.name}", or crash recovery is about to. Wait until that has ended; if it does not, redeploy the channel.`);
      }
      if (cm.status === 'PENDING') {
        throw new ServiceError('CONFLICT', `Message ${String(messageId)} is being sent to "${dest.name}" from its queue. Wait until that has ended; if it does not, redeploy the channel.`);
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

      // Re-enqueue with a fresh retry budget; the running consumer picks it up. What a target channel
      // recorded for an earlier send goes with it: a resend is sent, whatever an interrupted send delivered (D-393).
      await db.transaction(async (tx) => {
        const requeued = await tx
          .update(connectorMessages)
          .set({ status: 'QUEUED', sendAttempts: 0 })
          .where(and(
            eq(connectorMessages.channelId, channelId),
            eq(connectorMessages.messageId, messageId),
            eq(connectorMessages.metaDataId, metaDataId),
            eq(connectorMessages.status, cm.status),
          ))
          .returning({ messageId: connectorMessages.messageId });
        if (requeued.length === 0) {
          throw new ServiceError('CONFLICT', `Message ${String(messageId)} was not resent: it was deleted, or its status for "${dest.name}" changed, meanwhile. Look at it again.`);
        }
        await tx.delete(messageContent).where(and(
          eq(messageContent.channelId, channelId),
          eq(messageContent.messageId, messageId),
          eq(messageContent.metaDataId, metaDataId),
          eq(messageContent.contentType, CONTENT_TYPE.HAND_OFF),
        ));
      });

      emitEvent({
        level: 'INFO', name: 'MESSAGE_RESEND_QUEUED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { messageId, metaDataId },
      });

      return { messageId, metaDataId, status: 'QUEUED' as const };
    });
  }

  static async deleteMessage(
    channelId: string,
    messageId: number,
    context?: AuditContext,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const { unfinishedIds } = await deleteUnused(channelId, [messageId]);
      const unfinished = unfinishedIds.length > 0;
      emitEvent({
        level: 'WARN', name: 'MESSAGE_DELETED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { messageId, ...(unfinished ? { unfinished } : {}) },
      });
    });
  }

  /** Those that something may be working on are left and named. */
  static async bulkDelete(
    channelId: string,
    messageIds: readonly number[],
    context?: AuditContext,
  ): Promise<Result<BulkDeleteResult>> {
    return tryCatch(async () => {
      if (messageIds.length === 0) {
        return { deletedCount: 0, refusedIds: [] };
      }

      const { deletedIds, unfinishedIds, refusedIds } = await deleteUnused(channelId, messageIds);
      emitEvent({
        level: unfinishedIds.length > 0 ? 'WARN' : 'INFO', name: 'MESSAGES_DELETED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { deletedCount: deletedIds.length, ...(unfinishedIds.length > 0 ? { unfinishedIds } : {}) },
      });

      return { deletedCount: deletedIds.length, refusedIds };
    });
  }
}
