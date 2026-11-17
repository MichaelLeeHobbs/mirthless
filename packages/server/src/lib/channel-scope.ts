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
import { ALL_CHANNELS, can, type ChannelGroupId, type FoldedGrants, type Permission } from '@galvanigraph/core-models';
import { channelGroupMembers } from '../db/schema/index.js';
import { db } from './db.js';

/** A channel id: a path or body value that is not one names no channel, so no group. */
export const CHANNEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * Whether `grants` hold `permission` on the channel `channelId`. Looks the
 * channel's groups up only when the permission is scoped; a value that is not
 * a channel id is in no group.
 */
export async function holdsOnChannel(grants: FoldedGrants, permission: Permission, channelId: string): Promise<boolean> {
  const scope = grants.get(permission);
  if (scope === undefined) return false;
  if (scope === ALL_CHANNELS) return true;
  if (!CHANNEL_ID.test(channelId)) return false;
  return can(grants, permission, { groupIds: await channelGroupIds(channelId) });
}

/**
 * The channels the caller may see with `permission`: every channel when it is
 * held on all of them (a list then applies no filter, so channels in no group
 * still show), the channels in its groups when scoped, none when not held.
 */
export async function channelScopeOf(req: Request, permission: Permission): Promise<ChannelScope> {
  return grantedChannels(req.principal?.grants, permission);
}

/** The channels `grants` hold `permission` on, as `channelScopeOf` gives them for a request. */
export async function grantedChannels(grants: FoldedGrants | undefined, permission: Permission): Promise<ChannelScope> {
  const scope = grants?.get(permission);
  if (scope === undefined) return [];
  if (scope === ALL_CHANNELS) return ALL_CHANNELS;
  if (scope.size === 0) return [];
  const rows = await db.selectDistinct({ channelId: channelGroupMembers.channelId })
    .from(channelGroupMembers)
    .where(inArray(channelGroupMembers.channelGroupId, [...scope]));
  return rows.map((r) => r.channelId);
}

/**
 * Whether `grants` hold `permission` on every channel in `channelIds`. A list
 * naming no channel, and null (every channel, as a library's links), need it
 * on all channels; a value that is not a channel id, or a channel in no group,
 * is held only by an all-channel holder.
 */
export async function holdsOnEveryChannel(
  grants: FoldedGrants, permission: Permission, channelIds: readonly string[] | null, reader: Pick<typeof db, 'select'> = db,
): Promise<boolean> {
  const scope = grants.get(permission);
  if (scope === undefined) return false;
  if (scope === ALL_CHANNELS) return true;
  if (channelIds === null || channelIds.length === 0 || !channelIds.every((id) => CHANNEL_ID.test(id))) return false;
  const rows = await reader.select({ channelId: channelGroupMembers.channelId, groupId: channelGroupMembers.channelGroupId })
    .from(channelGroupMembers)
    .where(inArray(channelGroupMembers.channelId, [...channelIds]));
  const held = new Set(rows.filter((r) => scope.has(r.groupId as ChannelGroupId)).map((r) => r.channelId));
  return channelIds.every((id) => held.has(id));
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

/**
 * A record's channel links as a scoped reader may see them: the ones inside
 * `scope`, and how many were left out (plan section 2: "+N outside your access").
 */
export function linksInScope(channelIds: readonly string[], scope: ChannelScope): { readonly shown: string[]; readonly outsideScopeCount: number } {
  const shown = channelIds.filter((id) => inScope(scope, id));
  return { shown, outsideScopeCount: channelIds.length - shown.length };
}

/** Whether `channelId` is inside `scope`. */
export function inScope(scope: ChannelScope, channelId: string | null): boolean {
  if (scope === ALL_CHANNELS) return true;
  return channelId !== null && scope.includes(channelId);
}
