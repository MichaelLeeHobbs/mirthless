import { tryCatch } from 'stderr-lib';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../lib/db.js';
import logger from '../lib/logger.js';
import { channels } from '../db/schema/index.js';
import { MESSAGE_CHILD_TABLES } from './message-delete-helper.js';

// Until #403 a message could be deleted while it was being processed, and what was stored for it
// afterwards stayed. A message's row is stored before, or in one statement with, every other row it has,
// so a statement that sees one of those and not the message sees a message that was deleted.

const PAGE_ROWS = 2_000;
/** For this and for expired records. "Run now" is a request that waits for them; pg-boss ends a job after 15 minutes. What is left is for the next run. */
export const SWEEP_BUDGET_MS = { REQUEST: 30_000, SCHEDULED: 300_000 } as const;

export interface SweepResult {
  readonly rowsDeleted: number;
  /** It got to the end, and nothing failed, in the runs it went on from either. */
  readonly complete: boolean;
  readonly failed: boolean;
}

interface Step {
  readonly channelId: string;
  readonly table: (typeof MESSAGE_CHILD_TABLES)[number];
}

interface Position extends Step {
  readonly afterId: number;
}

/** Where a run that used up its time goes on. */
let resumeAt: Position | null = null;
let failedBefore = false;
let sweeping = false;

/** Every id below it was given out at least a day ago, or before this run when no message is younger than that. */
async function idLimit(): Promise<number> {
  const { rows } = await db.execute<{ limit: string | null }>(sql`
    SELECT COALESCE(min(recent.id), max(newest.id) + 1) AS "limit"
    FROM channels c
    LEFT JOIN LATERAL (
      SELECT id FROM messages WHERE channel_id = c.id AND received_at >= now() - interval '1 day' ORDER BY received_at LIMIT 1
    ) recent ON true
    LEFT JOIN LATERAL (SELECT id FROM messages WHERE channel_id = c.id ORDER BY id DESC LIMIT 1) newest ON true
  `);
  return Number(rows[0]?.limit ?? 0);
}

async function pageEnd({ channelId, table, afterId }: Position, limit: number): Promise<number | null> {
  const { rows } = await db.execute<{ last: string | null }>(sql`
    SELECT max(message_id) AS last FROM (
      SELECT message_id FROM ${sql.identifier(table)}
      WHERE channel_id = ${channelId} AND message_id > ${afterId} AND message_id < ${limit}
      ORDER BY message_id LIMIT ${PAGE_ROWS}
    ) page
  `);
  const last = rows[0]?.last ?? null;
  return last === null ? null : Number(last);
}

/** One that still waits on a queue is left: it would be delivered, and goes in a later run. */
async function deletePage({ channelId, table, afterId }: Position, last: number): Promise<number> {
  // On each table, so that every one of them is read through its index and no further than the page.
  const inPage = (id: SQL): SQL => sql`${id} > ${afterId} AND ${id} <= ${last}`;
  const deleted = await db.execute(sql`
    DELETE FROM ${sql.identifier(table)} r
    WHERE r.channel_id = ${channelId} AND ${inPage(sql`r.message_id`)}
      AND NOT EXISTS (
        SELECT 1 FROM messages m WHERE m.channel_id = ${channelId} AND m.id = r.message_id AND ${inPage(sql`m.id`)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM connector_messages q
        WHERE q.channel_id = ${channelId} AND q.message_id = r.message_id AND ${inPage(sql`q.message_id`)} AND q.status IN ('QUEUED', 'PENDING')
      )
  `);
  return deleted.rowCount ?? 0;
}

/** Walks its rows in short statements. Returns how many it deleted, and where it stopped when the time was up. */
async function sweepStep(from: Position, limit: number, deadline: number): Promise<{ deleted: number; stoppedAt: Position | null }> {
  let position = from;
  let deleted = 0;
  for (;;) {
    if (Date.now() >= deadline) return { deleted, stoppedAt: position };
    const last = await pageEnd(position, limit);
    if (last === null) return { deleted, stoppedAt: null };
    deleted += await deletePage(position, last);
    position = { ...position, afterId: last };
  }
}

async function sweep(budgetMs: number): Promise<SweepResult> {
  const limit = await idLimit();
  const deadline = Date.now() + budgetMs;
  // Deleted channels and those without pruning too: these rows belong to no message.
  const ids = await db.select({ id: channels.id }).from(channels).orderBy(channels.id);
  const steps: Step[] = ids.flatMap(({ id }) => MESSAGE_CHILD_TABLES.map((table) => ({ channelId: id, table })));
  const resumed = resumeAt;
  const start = Math.max(0, steps.findIndex((s) => s.channelId === resumed?.channelId && s.table === resumed.table));
  resumeAt = null;
  if (start === 0) failedBefore = false;

  let rowsDeleted = 0;
  let failed = false;
  for (const step of steps.slice(start)) {
    const goesOn = step.channelId === resumed?.channelId && step.table === resumed.table;
    const from = { ...step, afterId: goesOn ? resumed.afterId : 0 };
    // One that fails must not keep the others from being swept.
    const swept = await tryCatch(sweepStep(from, limit, deadline));
    if (!swept.ok) {
      failed = true;
      logger.error({ ...step, errMsg: swept.error.message }, 'Could not delete rows that deleted messages left behind');
      continue;
    }
    if (swept.value.deleted > 0) {
      rowsDeleted += swept.value.deleted;
      logger.warn({ ...step, rows: swept.value.deleted }, 'Deleted rows that deleted messages had left behind');
    }
    if (swept.value.stoppedAt) {
      resumeAt = swept.value.stoppedAt;
      break;
    }
  }
  failedBefore ||= failed;
  return { rowsDeleted, complete: !failedBefore && resumeAt === null, failed };
}

/** Deletes rows of messages that are no longer there. A run that finds another under way does nothing. */
export async function sweepLeftoverRows(budgetMs: number): Promise<SweepResult> {
  if (sweeping) return { rowsDeleted: 0, complete: false, failed: false };
  sweeping = true;
  try {
    return await sweep(budgetMs);
  } finally {
    sweeping = false;
  }
}
