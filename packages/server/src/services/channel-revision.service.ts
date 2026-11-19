import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, desc } from 'drizzle-orm';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { channelRevisions } from '../db/schema/index.js';

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

export class ChannelRevisionService {
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
