// The one place a user's standing is read (D-310), so a role edit, an assignment
// change or an expiry reaches every path at the next request.

import { eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod/v4';
import {
  ALL_CHANNELS, PERMISSIONS, foldGrants, type ChannelGroupId, type AssignmentGrant, type FoldedGrants, type Permission,
} from '@galvanigraph/core-models';
import { users, assignments, assignmentGroups, roles, rolePermissions } from '../db/schema/index.js';
import { db } from './db.js';
import logger from './logger.js';

export interface UserStanding {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly enabled: boolean;
  readonly mustChangePassword: boolean;
  readonly roles: readonly string[];
  readonly grants: FoldedGrants;
  readonly permissions: readonly Permission[];
  /** When the first expiring live assignment ends (D-310). */
  readonly nextExpiry: Date | null;
}

export function nextExpiryOf(grants: readonly AssignmentGrant[], now: Date): Date | null {
  let next: Date | null = null;
  for (const { expiresAt } of grants) {
    if (expiresAt instanceof Date && expiresAt.getTime() > now.getTime() && (next === null || expiresAt < next)) next = expiresAt;
  }
  return next;
}

const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

const assignmentRowSchema = z.object({
  role: z.string(),
  admin: z.boolean(),
  permissions: z.array(z.string()),
  expiresAt: z.string().nullable(),
  /** Required: a row without it fails closed, never widens to every channel. */
  allChannels: z.boolean(),
  groupIds: z.array(z.string()).default([]),
});
const assignmentRowsSchema = z.array(assignmentRowSchema);

type Executor = Pick<typeof db, 'select'>;

function isPermission(name: string): name is Permission {
  return KNOWN_PERMISSIONS.has(name);
}

// What "live" means, in two forms of one rule: the Drizzle condition and the
// test on alias `a`. Change both together.

export function isLiveAssignment(): SQL {
  return or(isNull(assignments.expiresAt), gt(assignments.expiresAt, sql`now()`)) as SQL;
}

/** A function, so importing this file builds no SQL. */
function liveOnAliasA(): SQL {
  return sql.raw('(a.expires_at IS NULL OR a.expires_at > now())');
}

/** Correlated on the outer `users` row. */
export function heldRoleNamesSql(): SQL<string[]> {
  return sql<string[]>`coalesce((
  SELECT array_agg(DISTINCT r.name ORDER BY r.name)
  FROM ${assignments} a JOIN ${roles} r ON r.id = a.role_id
  WHERE a.user_id = ${users}.id AND ${liveOnAliasA()}
), '{}')`;
}

/**
 * Aliases: inside a single-table select Drizzle leaves column names
 * unqualified, which the correlated subquery would make ambiguous.
 */
function liveAssignments(): SQL<unknown> {
  return sql<unknown>`coalesce((
  SELECT json_agg(json_build_object(
    'role', r.name,
    'admin', r.admin,
    'permissions', coalesce((SELECT json_agg(rp.permission) FROM ${rolePermissions} rp WHERE rp.role_id = r.id), '[]'::json),
    'expiresAt', a.expires_at,
    'allChannels', a.all_channels,
    'groupIds', coalesce((SELECT json_agg(ag.channel_group_id) FROM ${assignmentGroups} ag WHERE ag.assignment_id = a.id), '[]'::json)
  ))
  FROM ${assignments} a JOIN ${roles} r ON r.id = a.role_id
  WHERE a.user_id = ${users}.id AND ${liveOnAliasA()}
), '[]'::json)`;
}

/**
 * A permission name this code does not know (from a newer or older version)
 * grants nothing; an unreadable row fails closed.
 */
export function toAssignmentGrants(userId: string, raw: unknown): { readonly roles: readonly string[]; readonly grants: readonly AssignmentGrant[] } {
  const parsed = assignmentRowsSchema.safeParse(raw);
  if (!parsed.success) {
    logger.error({ userId }, 'Unreadable assignments; the user holds no permissions until they are fixed');
    return { roles: [], grants: [] };
  }
  const unknown = parsed.data.flatMap((a) => a.permissions.filter((p) => !isPermission(p)));
  if (unknown.length > 0) logger.warn({ userId, unknown: [...new Set(unknown)] }, 'Role grants permissions this server does not know; ignored');
  return {
    roles: [...new Set(parsed.data.map((a) => a.role))].sort(),
    grants: parsed.data.map((a) => ({
      permissions: a.admin ? ALL_PERMISSIONS : a.permissions.filter(isPermission),
      // A scoped assignment with no groups covers nothing (foldGrants drops it).
      scope: a.allChannels ? ALL_CHANNELS : (a.groupIds as ChannelGroupId[]),
      expiresAt: a.expiresAt === null ? null : new Date(a.expiresAt),
    })),
  };
}

export async function queryUserStanding(executor: Executor, userId: string, now: Date = new Date()): Promise<UserStanding | null> {
  const [row] = await executor
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      enabled: users.enabled,
      mustChangePassword: users.mustChangePassword,
      assignments: liveAssignments(),
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) return null;
  const held = toAssignmentGrants(row.id, row.assignments);
  const grants = foldGrants(held.grants, now);
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    enabled: row.enabled,
    mustChangePassword: row.mustChangePassword,
    roles: held.roles,
    grants,
    permissions: [...grants.keys()].sort(),
    nextExpiry: nextExpiryOf(held.grants, now),
  };
}

export function loadUserStanding(userId: string): Promise<UserStanding | null> {
  return queryUserStanding(db, userId);
}

export function roleLabel(roleNames: readonly string[]): string {
  return roleNames.join(', ');
}
