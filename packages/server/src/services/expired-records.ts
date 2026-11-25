import { tryCatch } from 'stderr-lib';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db.js';
import logger from '../lib/logger.js';

const BATCH_ROWS = 1_000;

export interface ExpiredPrune {
  readonly deleted: number;
  /** The number deleted, by collection id. */
  readonly byCollection: Readonly<Record<string, number>>;
  /** False when some are for the next run. */
  readonly complete: boolean;
  readonly failed: boolean;
}

/**
 * Only what both clocks say has expired: the server's, which gave the record its life, and the
 * database's, since one that jumped ahead would delete every record with a life. A row that someone is
 * changing is left for the next run, and the condition holds for the row as it is when it is deleted.
 */
async function deleteBatch(now: string): Promise<readonly string[]> {
  const { rows } = await db.execute<{ collection_id: string }>(sql`
    WITH expired AS (
      SELECT id FROM collection_records
      WHERE expire_at < LEAST(${now}::timestamptz, now())
      ORDER BY expire_at
      LIMIT ${BATCH_ROWS}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM collection_records r USING expired
    WHERE r.id = expired.id AND r.expire_at < LEAST(${now}::timestamptz, now())
    RETURNING r.collection_id
  `);
  return rows.map((row) => row.collection_id);
}

/** Never rejects: what was deleted before a failure is in the result. */
export async function pruneExpiredRecords(budgetMs: number): Promise<ExpiredPrune> {
  const started = Date.now();
  const now = new Date(started).toISOString();
  const byCollection: Record<string, number> = {};
  let deleted = 0;
  const run = await tryCatch(async () => {
    for (;;) {
      const batch = await deleteBatch(now);
      deleted += batch.length;
      for (const id of batch) byCollection[id] = (byCollection[id] ?? 0) + 1;
      if (batch.length < BATCH_ROWS) return true;
      if (Date.now() - started >= budgetMs) return false;
    }
  });
  if (!run.ok) logger.error({ errMsg: run.error.message, deleted }, 'Data pruner could not delete every expired collection record');
  return { deleted, byCollection, complete: run.ok && run.value, failed: !run.ok };
}
