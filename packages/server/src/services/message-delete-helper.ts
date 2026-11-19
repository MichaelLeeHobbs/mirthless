import { sql } from 'drizzle-orm';
import { db } from '../lib/db.js';

/**
 * Most ids deleted in one transaction. Each id is one bind parameter and Postgres
 * allows 65,535 per statement, so an unbounded list fails outright. A bounded batch
 * also keeps each transaction, and the locks it holds, short.
 */
export const DELETE_BATCH_SIZE = 1_000;

/**
 * One transaction per batch, so a message is never left with some of its child rows. A
 * failure stops at the failing batch; earlier batches stay deleted.
 */
export async function deleteMessagesByIds(channelId: string, messageIds: readonly number[]): Promise<void> {
  for (let start = 0; start < messageIds.length; start += DELETE_BATCH_SIZE) {
    await deleteBatch(channelId, messageIds.slice(start, start + DELETE_BATCH_SIZE));
  }
}

async function deleteBatch(channelId: string, messageIds: readonly number[]): Promise<void> {
  // One bind param per id: a JS array passed to `= ANY($1)` renders a malformed Postgres
  // array literal through drizzle/pg.
  const idList = sql.join(messageIds.map((id) => sql`${id}`), sql`, `);

  await db.transaction(async (tx) => {
    for (const table of ['message_attachments', 'message_custom_metadata', 'message_content', 'connector_messages'] as const) {
      await tx.execute(sql`
        DELETE FROM ${sql.identifier(table)}
        WHERE channel_id = ${channelId}
          AND message_id IN (${idList})
      `);
    }

    await tx.execute(sql`
      DELETE FROM messages
      WHERE channel_id = ${channelId}
        AND id IN (${idList})
    `);
  });
}
