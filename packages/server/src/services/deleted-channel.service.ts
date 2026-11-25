// Deleting a channel keeps its messages. Here they are listed, and removed at an administrator's word (#202, D-389).

import { tryCatch, type Result } from 'stderr-lib';
import { and, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { ALL_CHANNELS, AUDIT_ACTION } from '@galvanigraph/core-models';
import { errorInfo } from '@galvanigraph/core-util';
import { getEngine } from '../engine.js';
import { channels } from '../db/schema/index.js';
import { channelIdIn, type ChannelScope } from '../lib/channel-scope.js';
import { inTurn } from '../lib/channel-turns.js';
import { db } from '../lib/db.js';
import type { AuditContext } from '../lib/event-emitter.js';
import logger from '../lib/logger.js';
import { PG_ERROR, pgCode } from '../lib/pg-error.js';
import { ServiceError } from '../lib/service-error.js';
import { AuditService, type AuditTransaction } from './audit.service.js';
import { DEFAULT_MAX_AGE_DAYS } from './data-pruner.service.js';
import { MESSAGE_CHILD_TABLES } from './message-delete-helper.js';

export interface MessageNumbers {
  readonly messages: number;
  /** Of them, those that are not processed or that a destination has not sent yet. */
  readonly undelivered: number;
}

export interface DeletedChannel extends MessageNumbers {
  readonly channelId: string;
  readonly name: string;
  readonly deletedAt: string;
  readonly firstReceivedAt: string | null;
  readonly lastReceivedAt: string | null;
  /** Null when the pruner leaves them. */
  readonly prunedAfterDays: number | null;
}

interface CountRow extends Record<string, unknown> {
  readonly messages: string;
  readonly undelivered: string;
  readonly first: string | null;
  readonly last: string | null;
}

// A row an earlier delete left behind is of no message, so it is not an undelivered one.
function counts(channelId: SQL): SQL {
  return sql`
    SELECT count(*) AS messages, min(received_at) AS first, max(received_at) AS last, (
      SELECT count(*) FROM (
        SELECT id FROM messages WHERE channel_id = ${channelId} AND NOT processed
        UNION
        SELECT cm.message_id FROM connector_messages cm
        WHERE cm.channel_id = ${channelId} AND cm.status IN ('QUEUED', 'PENDING')
          AND EXISTS (SELECT 1 FROM messages m WHERE m.channel_id = ${channelId} AND m.id = cm.message_id)
      ) waiting
    ) AS undelivered
    FROM messages WHERE channel_id = ${channelId}
  `;
}

/** Rows that an earlier delete left behind are of no message, and hold content all the same. */
function holdsAnything(channelId: SQL): SQL {
  const tables = ['messages', ...MESSAGE_CHILD_TABLES];
  return sql.join(tables.map((table) => sql`EXISTS (SELECT 1 FROM ${sql.identifier(table)} WHERE channel_id = ${channelId})`), sql` OR `);
}

const isoOrNull = (value: string | null): string | null => (value === null ? null : new Date(value).toISOString());

type Counted = CountRow & { readonly holds: boolean };

/**
 * One statement for each channel. With the id a constant, Postgres plans only that channel's
 * partitions; with it a column of a join, it plans and locks every channel's, which takes seconds
 * to minutes once there are some hundred channels.
 */
async function countsOf(channelId: string): Promise<Counted | undefined> {
  const id = sql`${channelId}::uuid`;
  return (await db.execute<Counted>(sql`SELECT (${holdsAnything(id)}) AS holds, n.* FROM (${counts(id)}) n`)).rows[0];
}

/** A lock the purge could not have, or a deadlock with a statement that took the tables in another order. */
const GAVE_WAY: readonly unknown[] = [PG_ERROR.LOCK_NOT_AVAILABLE, PG_ERROR.DEADLOCK_DETECTED];

async function emptyTables(tx: AuditTransaction, channelId: string): Promise<void> {
  try {
    await tx.execute(sql`SELECT public.purge_deleted_channel(${channelId}::uuid)`);
  } catch (err) {
    if (!GAVE_WAY.includes(pgCode(err))) throw err;
    throw new ServiceError('CONFLICT', 'The messages are being read, or a backup is under way. Nothing was removed. Try again later.');
  }
}

async function removeAll(tx: AuditTransaction, channelId: string, reason: string, actor: AuditContext): Promise<MessageNumbers> {
  const [channel] = await tx.select({ name: channels.name, deletedAt: channels.deletedAt }).from(channels).where(eq(channels.id, channelId)).for('update');
  if (!channel) throw new ServiceError('NOT_FOUND', `Channel not found: ${channelId}`);
  if (channel.deletedAt === null) throw new ServiceError('CONFLICT', 'The channel is not deleted, so its messages are not removed');
  const counted = (await tx.execute<CountRow>(counts(sql`${channelId}::uuid`))).rows[0];
  const numbers = { messages: Number(counted?.messages ?? 0), undelivered: Number(counted?.undelivered ?? 0) };
  await emptyTables(tx, channelId);
  try {
    await AuditService.recordInTx(tx, {
      action: AUDIT_ACTION.MESSAGES_PURGED, outcome: 'SUCCESS', channelId,
      userId: actor.userId ?? null, ipAddress: actor.ipAddress ?? null,
      attributes: { channelName: channel.name, deletedAt: channel.deletedAt.toISOString(), ...numbers, reason },
    });
  } catch (err) {
    logger.error({ channelId, ...errorInfo(err) }, 'Could not record the removal of a deleted channel\'s messages');
    throw new ServiceError('AUDIT_UNAVAILABLE', 'The audit log could not record this purge, so nothing was removed.');
  }
  return numbers;
}

export class DeletedChannelService {
  /** Deleted channels that still have messages, or rows of messages, in the reader's `scope`. */
  static async list(scope: ChannelScope = ALL_CHANNELS): Promise<Result<readonly DeletedChannel[]>> {
    return tryCatch(async () => {
      const deleted = await db.select({
        id: channels.id, name: channels.name, deletedAt: channels.deletedAt, pruningEnabled: channels.pruningEnabled, pruningMaxAgeDays: channels.pruningMaxAgeDays,
      }).from(channels).where(and(isNotNull(channels.deletedAt), channelIdIn(channels.id, scope))).orderBy(desc(channels.deletedAt));
      const listed: DeletedChannel[] = [];
      for (const channel of deleted) {
        const row = await countsOf(channel.id);
        if (row?.holds !== true || channel.deletedAt === null) continue;
        listed.push({
          channelId: channel.id,
          name: channel.name,
          deletedAt: channel.deletedAt.toISOString(),
          messages: Number(row.messages),
          undelivered: Number(row.undelivered),
          firstReceivedAt: isoOrNull(row.first),
          lastReceivedAt: isoOrNull(row.last),
          prunedAfterDays: channel.pruningEnabled ? channel.pruningMaxAgeDays ?? DEFAULT_MAX_AGE_DAYS : null,
        });
      }
      return listed;
    });
  }

  /** All of them, undelivered ones too, with everything that belongs to them, or none. */
  static async purge(channelId: string, reason: string, actor: AuditContext): Promise<Result<MessageNumbers>> {
    return tryCatch(() => inTurn(channelId, async () => {
      const engine = getEngine();
      if (engine.getRuntime(channelId) !== undefined || !engine.isAtRest(channelId)) {
        throw new ServiceError('CONFLICT', 'The channel is still deployed, or works on a message. Nothing was removed.');
      }
      return db.transaction((tx) => removeAll(tx, channelId, reason, actor));
    }));
  }
}
