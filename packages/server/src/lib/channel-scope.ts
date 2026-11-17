// ===========================================
// Channel Scope
// ===========================================
// Which channel groups a channel belongs to, for the scope check every
// channel route makes (D-310, RBAC plan section 4). Read from the database on
// each request, so a membership change applies at once.

import { eq } from 'drizzle-orm';
import type { ChannelGroupId } from '@galvanigraph/core-models';
import { channelGroupMembers } from '../db/schema/index.js';
import { db } from './db.js';

/** The groups `channelId` is in; none for a channel in no group or one that does not exist. */
export async function channelGroupIds(channelId: string): Promise<readonly ChannelGroupId[]> {
  const rows = await db.select({ groupId: channelGroupMembers.channelGroupId })
    .from(channelGroupMembers)
    .where(eq(channelGroupMembers.channelId, channelId));
  return rows.map((r) => r.groupId as ChannelGroupId);
}
