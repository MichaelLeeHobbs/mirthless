import { sql, type SQL } from 'drizzle-orm';
import { db } from '../lib/db.js';

/**
 * Most ids deleted in one transaction. Each id is one bind parameter and Postgres
 * allows 65,535 per statement, so an unbounded list fails outright. A bounded batch
 * also keeps each transaction, and the locks it holds, short.
 */
export const DELETE_BATCH_SIZE = 1_000;

/** What belongs to a message: its rows go with it. */
export const MESSAGE_CHILD_TABLES = ['message_attachments', 'message_custom_metadata', 'message_content', 'connector_messages'] as const;

export interface DeleteRules {
  /** Also a message that is not processed, and one that a queue has claimed. Asked again once its rows are locked. */
  readonly unfinished: () => boolean;
  /** Also a message that waits on a queue. */
  readonly queued: boolean;
}

export interface DeletedMessages {
  readonly deletedIds: readonly number[];
  /** Those of the deleted that were not processed, waited on a queue or were claimed by one. */
  readonly unfinishedIds: readonly number[];
  /** They are there, and something may be working on them. */
  readonly refusedIds: readonly number[];
}

type Executor = Pick<typeof db, 'execute'>;

interface LockedMessage {
  readonly id: number;
  readonly unfinished: boolean;
}

// One bind param per id: a JS array passed to `= ANY($1)` renders a malformed Postgres
// array literal through drizzle/pg.
function inIds(column: 'id' | 'message_id', ids: readonly number[]): SQL {
  return sql`${sql.identifier(column)} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
}

/**
 * The messages that nothing works on, with their connectors, locked. Waits for no lock: a locked row
 * is in use, and waiting while holding others could end the pipeline's own write in a deadlock. A row
 * that would be refused is not locked, so the pipeline and the queue do not wait for a batch of deletes.
 */
async function lockUnused(tx: Executor, channelId: string, ids: readonly number[], rules: DeleteRules): Promise<readonly LockedMessage[]> {
  const unfinished = rules.unfinished();
  const free = rules.queued ? sql`status <> 'PENDING'` : sql`status NOT IN ('PENDING', 'QUEUED')`;
  const locked = await tx.execute<{ id: string; processed: boolean }>(sql`
    SELECT id, processed FROM messages
    WHERE channel_id = ${channelId} AND ${inIds('id', ids)} AND ${unfinished ? sql`true` : sql`processed`}
    ORDER BY id FOR UPDATE SKIP LOCKED
  `);
  if (locked.rows.length === 0) return [];
  const lockedIds = locked.rows.map((row) => Number(row.id));
  const connectors = await tx.execute<{ message_id: string; status: string }>(sql`
    SELECT message_id, status FROM connector_messages
    WHERE channel_id = ${channelId} AND ${inIds('message_id', lockedIds)} AND ${unfinished ? sql`true` : free}
    FOR UPDATE SKIP LOCKED
  `);
  const all = await tx.execute<{ message_id: string; n: number }>(sql`
    SELECT message_id, count(*)::int AS n FROM connector_messages
    WHERE channel_id = ${channelId} AND ${inIds('message_id', lockedIds)} GROUP BY message_id
  `);
  if (unfinished && !rules.unfinished()) return [];

  const unlocked = new Map(all.rows.map((row) => [Number(row.message_id), row.n]));
  const waiting = new Set<number>();
  for (const { message_id, status } of connectors.rows) {
    const id = Number(message_id);
    unlocked.set(id, (unlocked.get(id) ?? 0) - 1);
    if (status === 'QUEUED' || status === 'PENDING') waiting.add(id);
  }
  // A connector that was not locked may be a claim or a resend that is not committed yet.
  return locked.rows
    .map((row) => ({ id: Number(row.id), unfinished: !row.processed || waiting.has(Number(row.id)) }))
    .filter(({ id }) => (unlocked.get(id) ?? 0) === 0);
}

async function deleteLocked(tx: Executor, channelId: string, ids: readonly number[]): Promise<void> {
  for (const table of MESSAGE_CHILD_TABLES) {
    await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE channel_id = ${channelId} AND ${inIds('message_id', ids)}`);
  }
  await tx.execute(sql`DELETE FROM messages WHERE channel_id = ${channelId} AND ${inIds('id', ids)}`);
}

async function deleteBatch(channelId: string, ids: readonly number[], rules: DeleteRules): Promise<DeletedMessages> {
  return db.transaction(async (tx) => {
    const unused = await lockUnused(tx, channelId, ids, rules);
    const deletedIds = unused.map((message) => message.id);
    if (deletedIds.length > 0) await deleteLocked(tx, channelId, deletedIds);
    const left = deletedIds.length === ids.length ? [] : (await tx.execute<{ id: string }>(sql`
      SELECT id FROM messages WHERE channel_id = ${channelId} AND ${inIds('id', ids)} ORDER BY id
    `)).rows;
    return {
      deletedIds,
      unfinishedIds: unused.filter((message) => message.unfinished).map((message) => message.id),
      refusedIds: left.map((row) => Number(row.id)),
    };
  });
}

/**
 * One transaction per batch, so a message is never left with some of its child rows. A
 * failure stops at the failing batch; earlier batches stay deleted.
 */
export async function deleteMessagesByIds(channelId: string, messageIds: readonly number[], rules: DeleteRules): Promise<DeletedMessages> {
  const batches: DeletedMessages[] = [];
  for (let start = 0; start < messageIds.length; start += DELETE_BATCH_SIZE) {
    batches.push(await deleteBatch(channelId, messageIds.slice(start, start + DELETE_BATCH_SIZE), rules));
  }
  return {
    deletedIds: batches.flatMap((batch) => batch.deletedIds),
    unfinishedIds: batches.flatMap((batch) => batch.unfinishedIds),
    refusedIds: batches.flatMap((batch) => batch.refusedIds),
  };
}
