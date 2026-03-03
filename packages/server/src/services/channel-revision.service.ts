// ===========================================
// Channel Revision Service
// ===========================================
// Stores and retrieves channel configuration snapshots.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, desc } from 'drizzle-orm';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { channelRevisions } from '../db/schema/index.js';

// ----- Response Types -----

export interface RevisionSummary {
  readonly id: string;
  readonly channelId: string;
  readonly revision: number;
  readonly userId: string | null;
  readonly comment: string | null;
  readonly createdAt: Date;
}

export interface RevisionDetail extends RevisionSummary {
  readonly snapshot: Record<string, unknown>;
}

// ----- Service -----

export class ChannelRevisionService {
  /** Save a revision snapshot for a channel. */
  static async saveRevision(
    channelId: string,
    revision: number,
    snapshot: Record<string, unknown>,
    userId?: string | null,
    comment?: string | null,
  ): Promise<Result<RevisionSummary>> {
    return tryCatch(async () => {
      const [row] = await db
        .insert(channelRevisions)
        .values({
          channelId,
          revision,
          snapshot,
          userId: userId ?? null,
          comment: comment ?? null,
        })
        .returning();

      return {
        id: row!.id,
        channelId: row!.channelId,
        revision: row!.revision,
        userId: row!.userId,
        comment: row!.comment,
        createdAt: row!.createdAt,
      };
    });
  }

  /** List all revisions for a channel (newest first). */
  static async listRevisions(channelId: string): Promise<Result<readonly RevisionSummary[]>> {
    return tryCatch(async () => {
      const rows = await db
        .select({
          id: channelRevisions.id,
          channelId: channelRevisions.channelId,
          revision: channelRevisions.revision,
          userId: channelRevisions.userId,
          comment: channelRevisions.comment,
          createdAt: channelRevisions.createdAt,
        })
        .from(channelRevisions)
        .where(eq(channelRevisions.channelId, channelId))
        .orderBy(desc(channelRevisions.revision));

      return rows;
    });
  }

  /** Get a specific revision by channel ID and revision number. */
  static async getRevision(
    channelId: string,
    revision: number,
  ): Promise<Result<RevisionDetail>> {
    return tryCatch(async () => {
      const [row] = await db
        .select()
        .from(channelRevisions)
        .where(
          and(
            eq(channelRevisions.channelId, channelId),
            eq(channelRevisions.revision, revision),
          ),
        );

      if (!row) {
        throw new ServiceError('NOT_FOUND', `Revision ${String(revision)} not found for channel ${channelId}`);
      }

      return {
        id: row.id,
        channelId: row.channelId,
        revision: row.revision,
        userId: row.userId,
        comment: row.comment,
        snapshot: row.snapshot,
        createdAt: row.createdAt,
      };
    });
  }
}
