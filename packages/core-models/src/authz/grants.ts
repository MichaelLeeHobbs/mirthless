// D-310. A permission's scope is the union of its live assignments' scopes;
// there are no deny rules.

import type { Permission } from '../constants.js';
import type { ChannelGroupId } from '../brands.js';

export const ALL_CHANNELS = 'all' as const;

export type GrantScope = typeof ALL_CHANNELS | ReadonlySet<ChannelGroupId>;

export interface AssignmentGrant {
  readonly permissions: readonly Permission[];
  readonly scope: typeof ALL_CHANNELS | readonly ChannelGroupId[];
  readonly expiresAt?: Date | null;
}

export type FoldedGrants = ReadonlyMap<Permission, GrantScope>;

function widen(current: GrantScope | undefined, scope: AssignmentGrant['scope']): GrantScope | undefined {
  if (current === ALL_CHANNELS || scope === ALL_CHANNELS) return ALL_CHANNELS;
  if (scope.length === 0) return current;
  return new Set([...(current ?? []), ...scope]);
}

function isLive(expiresAt: Date | null | undefined, now: Date): boolean {
  if (expiresAt === undefined || expiresAt === null) return true;
  return expiresAt.getTime() > now.getTime();
}

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

/** No target means held anywhere: a route guard before the record is known. */
export function can(grants: FoldedGrants, permission: Permission, target?: { readonly groupIds: readonly ChannelGroupId[] }): boolean {
  const scope = grants.get(permission);
  if (scope === undefined) return false;
  if (scope === ALL_CHANNELS || target === undefined) return true;
  return target.groupIds.some((g) => scope.has(g));
}

export interface GrantEntry {
  readonly permission: Permission;
  readonly scope: typeof ALL_CHANNELS | readonly ChannelGroupId[];
}

/** For the login and refresh answers (D-298). */
export function serializeGrants(grants: FoldedGrants): readonly GrantEntry[] {
  return [...grants.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([permission, scope]) => ({ permission, scope: scope === ALL_CHANNELS ? ALL_CHANNELS : [...scope].sort() }));
}

/**
 * Whether a flat permission list, as the server holds it until grants are
 * resolved from the database (#265 slice 6), includes `permission`. The one
 * place such a list is searched: lint bans `permissions.includes` elsewhere.
 */
export function holdsPermission(permissions: readonly string[] | undefined, permission: Permission): boolean {
  return (permissions ?? []).includes(permission);
}
