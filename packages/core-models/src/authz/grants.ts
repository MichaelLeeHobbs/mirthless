// ===========================================
// Grants
// ===========================================
// How assignments combine into what a principal may do, and the one check
// every guard, editor and access view uses (D-310). Pure: no I/O.
//
// Each permission's scope is the union of the scopes of the live assignments
// whose role grants it. An all-channel scope covers everything. There are no
// deny rules.

import type { Permission } from '../constants.js';
import type { ChannelGroupId } from '../brands.js';

/** The scope of an assignment that covers every channel. */
export const ALL_CHANNELS = 'all' as const;

/** Every channel, or the channel groups a grant covers. */
export type GrantScope = typeof ALL_CHANNELS | ReadonlySet<ChannelGroupId>;

/** One assignment, as the resolver hands it over: its role's permissions, its scope, its expiry. */
export interface AssignmentGrant {
  readonly permissions: readonly Permission[];
  readonly scope: typeof ALL_CHANNELS | readonly ChannelGroupId[];
  readonly expiresAt?: Date | null;
}

/** What a principal holds: each permission with the scope it covers. A missing permission is not held. */
export type FoldedGrants = ReadonlyMap<Permission, GrantScope>;

function widen(current: GrantScope | undefined, scope: AssignmentGrant['scope']): GrantScope | undefined {
  if (current === ALL_CHANNELS || scope === ALL_CHANNELS) return ALL_CHANNELS;
  if (scope.length === 0) return current;
  return new Set([...(current ?? []), ...scope]);
}

/** Whether an assignment still counts at `now`. An unreadable expiry counts as expired: this check fails closed. */
function isLive(expiresAt: Date | null | undefined, now: Date): boolean {
  if (expiresAt === undefined || expiresAt === null) return true;
  return expiresAt.getTime() > now.getTime();
}

/** Fold live assignments into the scope each permission covers. An assignment expiring at or before `now` counts for nothing. */
export function foldGrants(assignments: readonly AssignmentGrant[], now: Date): FoldedGrants {
  const folded = new Map<Permission, GrantScope>();
  for (const a of assignments) {
    if (!isLive(a.expiresAt, now)) continue;
    for (const p of a.permissions) {
      const scope = widen(folded.get(p), a.scope);
      if (scope !== undefined) folded.set(p, scope);
    }
  }
  return folded;
}

/**
 * Whether `grants` allow `permission`. With no target: held anywhere (a route
 * guard before the record is known). With a target: held on a channel in one
 * of `groupIds`, or on every channel.
 */
export function can(grants: FoldedGrants, permission: Permission, target?: { readonly groupIds: readonly ChannelGroupId[] }): boolean {
  const scope = grants.get(permission);
  if (scope === undefined) return false;
  if (scope === ALL_CHANNELS || target === undefined) return true;
  return target.groupIds.some((g) => scope.has(g));
}

/**
 * Whether a flat permission list, as the server holds it until grants are
 * resolved from the database (#265 slice 6), includes `permission`. The one
 * place such a list is searched: lint bans `permissions.includes` elsewhere.
 */
export function holdsPermission(permissions: readonly string[] | undefined, permission: Permission): boolean {
  return (permissions ?? []).includes(permission);
}
