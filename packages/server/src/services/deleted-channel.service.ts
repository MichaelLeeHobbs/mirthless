// Deleting a channel keeps its messages. Here they are listed, and removed at an administrator's word (#202, D-389).

import { tryCatch, type Result } from 'stderr-lib';
import { and, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { ALL_CHANNELS, AUDIT_ACTION } from '@galvanigraph/core-models';
import { getEngine } from '../engine.js';
import { channels } from '../db/schema/index.js';
import { channelIdIn, type ChannelScope } from '../lib/channel-scope.js';
import { inTurn } from '../lib/channel-turns.js';
import { db } from '../lib/db.js';
import type { AuditContext } from '../lib/event-emitter.js';
import { PG_ERROR, pgCode } from '../lib/pg-error.js';
import { ServiceError } from '../lib/service-error.js';
import { AuditService, type AuditTransaction } from './audit.service.js';
import { DEFAULT_MAX_AGE_DAYS } from './data-pruner.service.js';
import { MESSAGE_CHILD_TABLES } from './message-delete-helper.js';

export interface MessageNumbers {
  readonly messages: number;
  /** Of them, those that are not processed or wait on a queue. */
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

function counts(channelId: SQL): SQL {
  return sql`
    SELECT count(*) AS messages, min(received_at) AS first, max(received_at) AS last, (
      SELECT count(*) FROM (
        SELECT id FROM messages WHERE channel_id = ${channelId} AND NOT processed
        UNION
        SELECT message_id FROM connector_messages WHERE channel_id = ${channelId} AND status IN ('QUEUED', 'PENDING')
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

async function emptyTables(tx: AuditTransaction, channelId: string): Promise<void> {
  try {
    await tx.execute(sql`SELECT public.purge_deleted_channel(${channelId}::uuid)`);
  } catch (err) {
    if (pgCode(err) !== PG_ERROR.LOCK_NOT_AVAILABLE) throw err;
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
  } catch {
    throw new ServiceError('AUDIT_UNAVAILABLE', 'The audit log could not record this purge, so nothing was removed.');
  }
  return numbers;
}

export class DeletedChannelService {
  /** Deleted channels that still have messages, or rows of messages, in the reader's `scope`. */
  static async list(scope: ChannelScope = ALL_CHANNELS): Promise<Result<readonly DeletedChannel[]>> {
    return tryCatch(async () => {
      const id = sql`${channels.id}`;
      const { rows } = await db.execute<CountRow & { id: string; name: string; deleted_at: string; pruning_enabled: boolean; pruning_max_age_days: number | null }>(sql`
        SELECT ${channels.id}, ${channels.name}, ${channels.deletedAt}, ${channels.pruningEnabled}, ${channels.pruningMaxAgeDays}, n.*
        FROM ${channels}, LATERAL (${counts(id)}) n
        WHERE ${and(isNotNull(channels.deletedAt), channelIdIn(channels.id, scope))} AND (${holdsAnything(id)})
        ORDER BY ${channels.deletedAt} DESC
      `);
      return rows.map((row) => ({
        channelId: row.id,
        name: row.name,
        deletedAt: new Date(row.deleted_at).toISOString(),
        messages: Number(row.messages),
        undelivered: Number(row.undelivered),
        firstReceivedAt: isoOrNull(row.first),
        lastReceivedAt: isoOrNull(row.last),
        prunedAfterDays: row.pruning_enabled ? row.pruning_max_age_days ?? DEFAULT_MAX_AGE_DAYS : null,
      }));
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
