// ===========================================
// Attachment Service
// ===========================================
// Business logic for querying message attachments.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { and, eq } from 'drizzle-orm';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { messageAttachments } from '../db/schema/index.js';

// ----- Response Types -----

export interface AttachmentSummary {
  readonly id: string;
  readonly segmentId: number;
  readonly mimeType: string | null;
  readonly attachmentSize: number;
  readonly isEncrypted: boolean;
}

export interface AttachmentDetail extends AttachmentSummary {
  readonly content: string;
}

// ----- Service -----

export class AttachmentService {
  /** List all attachments for a message. */
  static async listByMessage(
    channelId: string,
    messageId: number,
  ): Promise<Result<readonly AttachmentSummary[]>> {
    return tryCatch(async () => {
      const rows = await db
        .select({
          id: messageAttachments.id,
          segmentId: messageAttachments.segmentId,
          mimeType: messageAttachments.mimeType,
          attachmentSize: messageAttachments.attachmentSize,
          isEncrypted: messageAttachments.isEncrypted,
        })
        .from(messageAttachments)
        .where(
          and(
            eq(messageAttachments.channelId, channelId),
            eq(messageAttachments.messageId, messageId),
          ),
        );

      return rows;
    });
  }

  /** Get a single attachment by ID (includes content). */
  static async getById(
    channelId: string,
    messageId: number,
    attachmentId: string,
  ): Promise<Result<AttachmentDetail>> {
    return tryCatch(async () => {
      const [row] = await db
        .select()
        .from(messageAttachments)
        .where(
          and(
            eq(messageAttachments.channelId, channelId),
            eq(messageAttachments.messageId, messageId),
            eq(messageAttachments.id, attachmentId),
          ),
        );

      if (!row) {
        throw new ServiceError('NOT_FOUND', `Attachment "${attachmentId}" not found`);
      }

      return {
        id: row.id,
        segmentId: row.segmentId,
        mimeType: row.mimeType,
        attachmentSize: row.attachmentSize,
        isEncrypted: row.isEncrypted,
        content: row.content,
      };
    });
  }
}
