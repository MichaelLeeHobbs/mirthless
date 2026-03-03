// ===========================================
// Message Delete Helper
// ===========================================
// Shared dependency-order message deletion used by both
// DataPrunerService and MessageReprocessService.

import { sql } from 'drizzle-orm';
import { db } from '../lib/db.js';

/**
 * Delete all message-related records for the given IDs in dependency order:
 * attachments → custom metadata → content → connector messages → messages.
 *
 * Runs inside a transaction to ensure atomicity.
 */
export async function deleteMessagesByIds(channelId: string, messageIds: readonly number[]): Promise<void> {
  const ids = [...messageIds];

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM message_attachments
      WHERE channel_id = ${channelId}
        AND message_id = ANY(${ids})
    `);

    await tx.execute(sql`
      DELETE FROM message_custom_metadata
      WHERE channel_id = ${channelId}
        AND message_id = ANY(${ids})
    `);

    await tx.execute(sql`
      DELETE FROM message_content
      WHERE channel_id = ${channelId}
        AND message_id = ANY(${ids})
    `);

    await tx.execute(sql`
      DELETE FROM connector_messages
      WHERE channel_id = ${channelId}
        AND message_id = ANY(${ids})
    `);

    await tx.execute(sql`
      DELETE FROM messages
      WHERE channel_id = ${channelId}
        AND id = ANY(${ids})
    `);
  });
}
