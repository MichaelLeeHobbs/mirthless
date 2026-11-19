// Channel scope of a caller's grants (D-310). Read from the database on each
// request so a membership change applies at once. A list filters with
// channel_id = ANY(<ids>), never a JOIN on memberships: a channel in two groups
// would be counted twice.

import { eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Request } from 'express';
import { ALL_CHANNELS, can, type ChannelGroupId, type FoldedGrants, type Permission } from '@galvanigraph/core-models';
import { channelGroupMembers } from '../db/schema/index.js';
import { db } from './db.js';

export const CHANNEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChannelScope = typeof ALL_CHANNELS | readonly string[];

export async function channelGroupIds(channelId: string): Promise<readonly ChannelGroupId[]> {
  const rows = await db.select({ groupId: channelGroupMembers.channelGroupId })
    .from(channelGroupMembers)
    .where(eq(channelGroupMembers.channelId, channelId));
  return rows.map((r) => r.groupId as ChannelGroupId);
}

export async function holdsOnChannel(grants: FoldedGrants, permission: Permission, channelId: string): Promise<boolean> {
  const scope = grants.get(permission);
  if (scope === undefined) return false;
  if (scope === ALL_CHANNELS) return true;
  if (!CHANNEL_ID.test(channelId)) return false;
  return can(grants, permission, { groupIds: await channelGroupIds(channelId) });
}

/** ALL_CHANNELS when held unscoped, so a list applies no filter and channels in no group still show. */
export async function channelScopeOf(req: Request, permission: Permission): Promise<ChannelScope> {
  return grantedChannels(req.principal?.grants, permission);
}

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

/** Null means every channel (a library's links); it and an empty list need the permission on all channels. */
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

export function channelIdIn(column: AnyColumn, scope: ChannelScope): SQL | undefined {
  if (scope === ALL_CHANNELS) return undefined;
  if (scope.length === 0) return sql`false`;
  return inArray(column, [...scope]);
}

export function linksInScope(channelIds: readonly string[], scope: ChannelScope): { readonly shown: string[]; readonly outsideScopeCount: number } {
  const shown = channelIds.filter((id) => inScope(scope, id));
  return { shown, outsideScopeCount: channelIds.length - shown.length };
}

export function inScope(scope: ChannelScope, channelId: string | null): boolean {
  if (scope === ALL_CHANNELS) return true;
  return channelId !== null && scope.includes(channelId);
}
