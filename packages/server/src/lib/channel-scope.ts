// ===========================================
// Channel Scope
// ===========================================
// Which channels a caller's grants cover (D-310, RBAC plan section 4): for the
// check a channel route makes, and for the filter a list or search applies.
// Read from the database on each request, so a membership change applies at
// once. A list filters with channel_id = ANY(<these ids>), never a JOIN on
// memberships: a channel in two groups would be counted twice.

import { eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Request } from 'express';
import { ALL_CHANNELS, type ChannelGroupId, type Permission } from '@galvanigraph/core-models';
import { channelGroupMembers } from '../db/schema/index.js';
import { db } from './db.js';

/** Every channel, or the ids of the channels a list may show. */
export type ChannelScope = typeof ALL_CHANNELS | readonly string[];

/** The groups `channelId` is in; none for a channel in no group or one that does not exist. */
export async function channelGroupIds(channelId: string): Promise<readonly ChannelGroupId[]> {
  const rows = await db.select({ groupId: channelGroupMembers.channelGroupId })
    .from(channelGroupMembers)
    .where(eq(channelGroupMembers.channelId, channelId));
  return rows.map((r) => r.groupId as ChannelGroupId);
}

/**
 * The channels the caller may see with `permission`: every channel when it is
 * held on all of them (a list then applies no filter, so channels in no group
 * still show), the channels in its groups when scoped, none when not held.
 */
export async function channelScopeOf(req: Request, permission: Permission): Promise<ChannelScope> {
  const scope = req.principal?.grants.get(permission);
  if (scope === undefined) return [];
  if (scope === ALL_CHANNELS) return ALL_CHANNELS;
  if (scope.size === 0) return [];
  const rows = await db.selectDistinct({ channelId: channelGroupMembers.channelId })
    .from(channelGroupMembers)
    .where(inArray(channelGroupMembers.channelGroupId, [...scope]));
  return rows.map((r) => r.channelId);
}

/**
 * The SQL condition that keeps `column` (a channel id) inside `scope`:
 * undefined for every channel (no filter), never true for none.
 */
export function channelIdIn(column: AnyColumn, scope: ChannelScope): SQL | undefined {
  if (scope === ALL_CHANNELS) return undefined;
  if (scope.length === 0) return sql`false`;
  return inArray(column, [...scope]);
}

/** Whether `channelId` is inside `scope`. */
export function inScope(scope: ChannelScope, channelId: string | null): boolean {
  if (scope === ALL_CHANNELS) return true;
  return channelId !== null && scope.includes(channelId);
}
