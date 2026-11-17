// ===========================================
// Grant Service
// ===========================================
// The only writer of the roles, role_permissions and assignments tables (D-310,
// RBAC plan section 5). Every change runs in the caller's transaction and is
// recorded in audit_log in that same transaction, so a change and its record
// commit together or not at all.
//
// The last enabled holder of the admin role is protected here: every change
// that could remove one (a role change, disabling or deleting a user) first
// takes a lock on the admin role row, so two such changes queue and the second
// sees the first's result. This replaces the user-row lock of #218/#234.
//
// Anti-escalation (plan section 5):
// - within rule: an actor may assign a role only when they hold every
//   permission it gives over the assignment's scope, and may add a permission
//   to a role only when they hold it over every scope the role is assigned on;
// - target rule: an actor may act on a user only when that user's permissions
//   are all among the actor's own;
// - nobody changes their own role (user.service), and the admin role is locked.

import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  ALL_CHANNELS, AUDIT_ACTION, DEFAULT_GROUP_NAME, PERMISSIONS, PERMISSION_CATALOG, PERMISSION_CLASS, allChannelsOnly, can,
  type AccessPath, type AssignmentInput, type AssignmentView, type ChannelAccessView, type ChannelGroupId, type CreateRoleInput, type FoldedGrants, type Permission, type UpdateRoleInput,
} from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { isLiveAssignment, queryUserStanding } from '../lib/principal.js';
import { db } from '../lib/db.js';
import { assignmentGroups, assignments, channelGroupMembers, channelGroups, channels, rolePermissions, roles, users } from '../db/schema/index.js';
import { AuditService, type AuditTransaction } from './audit.service.js';

/** Who made a change, for its audit row. */
export interface GrantActor {
  readonly userId: string | null;
  readonly ipAddress?: string | null;
}

/** A change to a user that could leave the server without an enabled admin. */
export interface AdminLossCheck {
  readonly userId: string;
  /** The user is being disabled or deleted. */
  readonly disabling: boolean;
  /** The role the user is being given instead of their current ones, if any. */
  readonly newRoleName?: string;
}

/**
 * Lock the admin role row for the rest of the transaction and return its id.
 * FOR NO KEY UPDATE serialises the last-admin checks without blocking an
 * insert whose foreign key points at the row (a new admin assignment).
 */
async function lockAdminRole(tx: AuditTransaction): Promise<string> {
  const [row] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.admin, true)).for('no key update');
  if (!row) throw new ServiceError('INTERNAL', 'The admin role is missing');
  return row.id;
}

/** Whether `userId` holds the admin role through a live assignment. */
async function holdsAdmin(tx: AuditTransaction, adminRoleId: string, userId: string): Promise<boolean> {
  const [row] = await tx.select({ id: assignments.id }).from(assignments)
    .where(and(eq(assignments.userId, userId), eq(assignments.roleId, adminRoleId), isLiveAssignment()))
    .limit(1);
  return row !== undefined;
}

/**
 * How many enabled users other than `userId` hold the admin role with no
 * expiry. A time-limited admin does not count: it would lapse and leave nobody.
 */
async function otherLastingAdmins(tx: AuditTransaction, adminRoleId: string, userId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(DISTINCT ${assignments.userId})::int` })
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.userId))
    .where(and(eq(assignments.roleId, adminRoleId), isNull(assignments.expiresAt), eq(users.enabled, true), ne(users.id, userId)));
  return row?.n ?? 0;
}

const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/** Drizzle's db or a transaction: what the rule checks read through. */
type Reader = Pick<typeof db, 'select'>;

/** A role as the API shows it. */
export interface RoleSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly builtIn: boolean;
  /** The locked admin role: every permission, never edited or deleted. */
  readonly admin: boolean;
  readonly permissions: readonly Permission[];
  /** Users holding the role through a live assignment. */
  readonly holders: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The permissions `actorId` holds now, from the same resolver every request uses. */
async function actorPermissions(reader: Reader, actorId: string | null): Promise<ReadonlySet<string>> {
  if (actorId === null) throw new ServiceError('FORBIDDEN', 'A change to access needs a signed-in actor');
  const standing = await queryUserStanding(reader, actorId);
  return new Set(standing?.enabled ? standing.permissions : []);
}

/** The within rule: refuse unless the actor holds every one of `permissions`. */
async function assertWithin(reader: Reader, actorId: string | null, permissions: readonly string[], what: string): Promise<void> {
  const held = await actorPermissions(reader, actorId);
  const missing = permissions.filter((p) => !held.has(p)).sort();
  if (missing.length > 0) {
    throw new ServiceError('FORBIDDEN', `You can only ${what} with permissions you hold yourself. Missing: ${missing.join(', ')}`, { missing });
  }
}

/** A role's permissions: every permission for the admin role, its rows otherwise. */
async function permissionsOfRole(tx: Reader, role: { readonly id: string; readonly admin: boolean }): Promise<readonly Permission[]> {
  if (role.admin) return ALL_PERMISSIONS;
  const rows = await tx.select({ permission: rolePermissions.permission }).from(rolePermissions).where(eq(rolePermissions.roleId, role.id));
  const known = new Set<string>(ALL_PERMISSIONS);
  return rows.map((r) => r.permission).filter((p): p is Permission => known.has(p)).sort();
}

/**
 * Lock a role row for the rest of the transaction, or NOT_FOUND. An edit or a
 * delete takes FOR NO KEY UPDATE; an assignment takes FOR SHARE, so the two
 * queue and an assignment never gives a role's old permissions after an edit
 * has taken them away.
 */
async function lockRole(tx: AuditTransaction, id: string, mode: 'no key update' | 'share' = 'no key update'): Promise<{ readonly id: string; readonly name: string; readonly admin: boolean }> {
  const [row] = await tx.select({ id: roles.id, name: roles.name, admin: roles.admin }).from(roles).where(eq(roles.id, id)).for(mode);
  if (!row) throw new ServiceError('NOT_FOUND', `Role not found: ${id}`);
  return row;
}

/** Refuse a second role whose name differs from `name` only in case. */
async function assertNameFree(tx: AuditTransaction, name: string, exceptId?: string): Promise<void> {
  const [row] = await tx.select({ id: roles.id, name: roles.name }).from(roles)
    .where(sql`lower(${roles.name}) = lower(${name})`);
  if (row && row.id !== exceptId) throw new ServiceError('ALREADY_EXISTS', `A role is already named ${row.name}`);
}

/**
 * Every permission a live assignment scoped to one of `groupIds` grants: what
 * a channel joining those groups gives the assignments' holders.
 */
async function permissionsGrantedThrough(tx: AuditTransaction, groupIds: readonly string[]): Promise<readonly Permission[]> {
  const rows = await tx.selectDistinct({ roleId: assignments.roleId, admin: roles.admin })
    .from(assignmentGroups)
    .innerJoin(assignments, eq(assignments.id, assignmentGroups.assignmentId))
    .innerJoin(roles, eq(roles.id, assignments.roleId))
    .where(and(inArray(assignmentGroups.channelGroupId, [...groupIds]), isLiveAssignment()));
  const all = new Set<Permission>();
  for (const row of rows) {
    for (const p of await permissionsOfRole(tx, { id: row.roleId, admin: row.admin })) all.add(p);
  }
  return [...all];
}

/** The Default group's id, or null when there is none. */
async function defaultGroupId(reader: Reader): Promise<string | null> {
  const [row] = await reader.select({ id: channelGroups.id }).from(channelGroups).where(eq(channelGroups.name, DEFAULT_GROUP_NAME));
  return row?.id ?? null;
}

/** The group a scoped writer's new channel joins: `groupId` when it is theirs, else their only write group. */
function scopedTarget(writeGroups: ReadonlySet<ChannelGroupId>, groupId: string | undefined): string {
  if (groupId !== undefined) {
    if (!writeGroups.has(groupId as ChannelGroupId)) throw new ServiceError('FORBIDDEN', 'You can only put a new channel in a group where you can change channels');
    return groupId;
  }
  const [only, ...more] = [...writeGroups];
  if (only === undefined || more.length > 0) {
    throw new ServiceError('INVALID_INPUT', 'You can change channels in more than one group; name the group for the new channel (groupId)');
  }
  return only;
}

/** The role named `name`, locked for the assignment, or an INVALID_INPUT error. */
async function roleByName(tx: AuditTransaction, name: string): Promise<{ readonly id: string; readonly admin: boolean }> {
  const [row] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.name, name));
  if (!row) throw new ServiceError('INVALID_INPUT', `No role is named ${name}`);
  return lockRole(tx, row.id, 'share');
}

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';

/**
 * Turn a constraint a concurrent change hit into the answer the checks would
 * have given: a name taken in the meantime, or a role assigned in the meantime.
 */
function asConflict(err: unknown): unknown {
  const code = (err as { code?: unknown; cause?: { code?: unknown } }).code ?? (err as { cause?: { code?: unknown } }).cause?.code;
  if (code === PG_UNIQUE_VIOLATION) return new ServiceError('ALREADY_EXISTS', 'A role with that name was just created');
  if (code === PG_FOREIGN_KEY_VIOLATION) return new ServiceError('CONFLICT', 'The role was just assigned; remove that assignment first');
  return err;
}

/**
 * The target rule for a role edit: every user holding the role must be one
 * the actor could act on directly, since the edit changes what each may do.
 */
async function assertCanManageHolders(tx: AuditTransaction, roleId: string, actorId: string | null): Promise<void> {
  if (actorId === null) throw new ServiceError('FORBIDDEN', 'A change to access needs a signed-in actor');
  const holders = await tx.selectDistinct({ userId: assignments.userId }).from(assignments)
    .where(and(eq(assignments.roleId, roleId), isLiveAssignment()));
  for (const { userId } of holders) {
    await GrantService.assertCanManage(tx, actorId, userId);
  }
}

// ----- Scoped assignments (plan sections 1 and 5) -----

/** A scope as the rules compare it: every channel, or these groups. */
type ScopeIds = readonly string[] | null;

/** Whether `grants` hold `permission` over all of `scope`: on every channel, or on each of its groups. */
function holdsOver(grants: FoldedGrants, permission: Permission, scope: ScopeIds): boolean {
  const held = grants.get(permission);
  if (held === undefined) return false;
  if (held === ALL_CHANNELS) return true;
  return scope !== null && scope.every((g) => held.has(g as ChannelGroupId));
}

/** The actor's grants, or none for no actor or a disabled one. */
async function actorGrants(reader: Reader, actorId: string | null): Promise<FoldedGrants> {
  if (actorId === null) throw new ServiceError('FORBIDDEN', 'A change to access needs a signed-in actor');
  const standing = await queryUserStanding(reader, actorId);
  return standing?.enabled === true ? standing.grants : new Map();
}

/** Refuse a scoped assignment of a role holding a permission limited to all-channel assignments (plan section 1). */
function assertScopeAllowed(roleName: string, permissions: readonly Permission[], scope: ScopeIds): void {
  if (scope === null) return;
  const limited = permissions.filter(allChannelsOnly).sort();
  if (limited.length > 0) {
    throw new ServiceError('INVALID_INPUT', `${roleName} can only be given on every channel: it holds ${limited.join(', ')}`, { allChannelsOnly: limited });
  }
}

/** The within rule for an assignment: the actor holds every one of the role's permissions over its scope. */
function assertActorHoldsOver(grants: FoldedGrants, roleName: string, permissions: readonly Permission[], scope: ScopeIds): void {
  const missing = permissions.filter((p) => !holdsOver(grants, p, scope)).sort();
  if (missing.length > 0) {
    const where = scope === null ? 'every channel' : 'each group of the scope';
    throw new ServiceError('FORBIDDEN', `You can only give ${roleName} on ${where} where you hold its permissions. Missing: ${missing.join(', ')}`, { missing });
  }
}

/**
 * Lock the groups of every scope, in id order so two writers queue rather
 * than deadlock (plan section 5: role rows, then group rows). A missing group
 * is NOT_FOUND; Default cannot be a scope, since every new channel may join it.
 */
async function lockScopeGroups(tx: AuditTransaction, scopes: readonly ScopeIds[]): Promise<void> {
  const ids = [...new Set(scopes.flatMap((s) => s ?? []))].sort();
  if (ids.length === 0) return;
  const found = await tx.select({ id: channelGroups.id, name: channelGroups.name }).from(channelGroups)
    .where(inArray(channelGroups.id, ids)).orderBy(asc(channelGroups.id)).for('update');
  const missing = ids.filter((id) => !found.some((g) => g.id === id));
  if (missing.length > 0) throw new ServiceError('NOT_FOUND', `Channel group not found: ${missing.join(', ')}`);
  if (found.some((g) => g.name === DEFAULT_GROUP_NAME)) {
    throw new ServiceError('INVALID_INPUT', `The ${DEFAULT_GROUP_NAME} group cannot be a scope: every new channel may join it`);
  }
}

/** A user's assignments, oldest first, as the API and the audit log show them. */
async function assignmentsOf(reader: Reader, userId: string): Promise<AssignmentView[]> {
  const rows = await reader.select({
    id: assignments.id, roleId: assignments.roleId, roleName: roles.name, allChannels: assignments.allChannels,
    expiresAt: assignments.expiresAt, reason: assignments.reason, createdAt: assignments.createdAt,
  }).from(assignments).innerJoin(roles, eq(roles.id, assignments.roleId))
    .where(eq(assignments.userId, userId)).orderBy(asc(assignments.createdAt), asc(assignments.id));
  const groupRows = rows.length === 0 ? [] : await reader.select({ assignmentId: assignmentGroups.assignmentId, groupId: assignmentGroups.channelGroupId })
    .from(assignmentGroups).where(inArray(assignmentGroups.assignmentId, rows.map((r) => r.id)));
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id, roleId: r.roleId, roleName: r.roleName,
    groupIds: r.allChannels ? null : groupRows.filter((g) => g.assignmentId === r.id).map((g) => g.groupId).sort(),
    expiresAt: r.expiresAt?.toISOString() ?? null, reason: r.reason,
    live: r.expiresAt === null || r.expiresAt.getTime() > now, createdAt: r.createdAt.toISOString(),
  }));
}

/** A wanted assignment with its role locked and its permissions read. */
interface ResolvedAssignment {
  readonly input: AssignmentInput;
  readonly role: { readonly id: string; readonly name: string; readonly admin: boolean };
  readonly permissions: readonly Permission[];
  readonly expiresAt: Date | null;
}

/** Lock each wanted role (FOR SHARE, in id order) and check its expiry, scope class and the within rule. */
async function resolveAssignments(tx: AuditTransaction, wanted: readonly AssignmentInput[], grants: FoldedGrants): Promise<ResolvedAssignment[]> {
  const roleIds = [...new Set(wanted.map((a) => a.roleId))].sort();
  const locked = new Map<string, { id: string; name: string; admin: boolean }>();
  for (const id of roleIds) locked.set(id, await lockRole(tx, id, 'share'));
  await lockScopeGroups(tx, wanted.map((a) => a.groupIds));
  const now = Date.now();
  const resolved: ResolvedAssignment[] = [];
  for (const input of wanted) {
    const role = locked.get(input.roleId)!;
    const expiresAt = input.expiresAt === null ? null : new Date(input.expiresAt);
    if (expiresAt !== null && expiresAt.getTime() <= now) throw new ServiceError('INVALID_INPUT', `An assignment of ${role.name} would already have expired`);
    const permissions = await permissionsOfRole(tx, role);
    assertScopeAllowed(role.name, permissions, input.groupIds);
    assertActorHoldsOver(grants, role.name, permissions, input.groupIds);
    resolved.push({ input, role, permissions, expiresAt });
  }
  return resolved;
}

/**
 * The scope-aware within rule for a role edit (plan section 5): each added
 * permission must be held over the scope of every assignment of the role,
 * expired ones included, since renewing one restores it. A permission limited
 * to all-channel assignments cannot join a role assigned over a group (409).
 */
async function assertRoleEditWithin(tx: AuditTransaction, roleId: string, added: readonly Permission[], actorId: string | null): Promise<void> {
  if (added.length === 0) return;
  const grants = await actorGrants(tx, actorId);
  const rows = await tx.select({ id: assignments.id, allChannels: assignments.allChannels, groupId: assignmentGroups.channelGroupId })
    .from(assignments).leftJoin(assignmentGroups, eq(assignmentGroups.assignmentId, assignments.id))
    .where(eq(assignments.roleId, roleId));
  const scopes = new Map<string, string[] | null>();
  for (const r of rows) {
    if (r.allChannels) scopes.set(r.id, null);
    else scopes.set(r.id, [...(scopes.get(r.id) ?? []), ...(r.groupId === null ? [] : [r.groupId])]);
  }
  const scoped = [...scopes.entries()].filter(([, s]) => s !== null).map(([id]) => id);
  const limited = added.filter(allChannelsOnly);
  if (limited.length > 0 && scoped.length > 0) {
    throw new ServiceError('CONFLICT', `${limited.join(', ')} can only be held on every channel, and this role is assigned over groups`, { assignments: scoped });
  }
  const missing = added.filter((p) => !grants.has(p) || [...scopes.values()].some((s) => !holdsOver(grants, p, s))).sort();
  if (missing.length > 0) {
    throw new ServiceError('FORBIDDEN', `You can only add permissions you hold over every scope the role is assigned on. Missing: ${missing.join(', ')}`, { missing });
  }
}

/** The names of the roles `userId` holds through live assignments, sorted. */
async function heldRoleNames(tx: AuditTransaction, userId: string): Promise<readonly string[]> {
  const rows = await tx.selectDistinct({ name: roles.name }).from(assignments)
    .innerJoin(roles, eq(roles.id, assignments.roleId))
    .where(and(eq(assignments.userId, userId), isLiveAssignment()));
  return rows.map((r) => r.name).sort();
}

export class GrantService {
  /**
   * Refuse a change that would leave no enabled user holding the admin role.
   * Takes the admin role lock, so call it first in the transaction that writes
   * the change.
   */
  static async assertKeepsAnAdmin(tx: AuditTransaction, check: AdminLossCheck): Promise<void> {
    const adminRoleId = await lockAdminRole(tx);
    if (!(await holdsAdmin(tx, adminRoleId, check.userId))) return;
    const losesAdmin = check.disabling || (check.newRoleName !== undefined && (await roleByName(tx, check.newRoleName)).id !== adminRoleId);
    if (losesAdmin && (await otherLastingAdmins(tx, adminRoleId, check.userId)) === 0) {
      throw new ServiceError('CONFLICT', 'Cannot disable, delete or demote the last enabled admin user');
    }
  }

  /** The role names `userId` holds now, sorted. */
  static heldRoleNames(tx: AuditTransaction, userId: string): Promise<readonly string[]> {
    return heldRoleNames(tx, userId);
  }

  /**
   * Give `userId` exactly one all-channel assignment of the role named
   * `roleName`, replacing whatever they held, and record it. Returns the role
   * names held before. A no-op when that is already all they hold.
   */
  static async setUserRole(tx: AuditTransaction, userId: string, roleName: string, actor: GrantActor): Promise<readonly string[]> {
    const role = await roleByName(tx, roleName);
    // Access set per group or until a time is changed on the assignments; this
    // path would replace it with one lasting all-channel role without saying so.
    const held = await assignmentsOf(tx, userId);
    if (held.some((a) => a.groupIds !== null || a.expiresAt !== null)) {
      throw new ServiceError('CONFLICT', 'This user\'s access is set per group or until a time; change it on their assignments');
    }
    const before = await heldRoleNames(tx, userId);
    if (before.length === 1 && before[0] === roleName) return before;
    assertActorHoldsOver(await actorGrants(tx, actor.userId), roleName, await permissionsOfRole(tx, role), null);
    const current = await tx.select({ id: assignments.id }).from(assignments).where(eq(assignments.userId, userId));
    if (current.length > 0) await tx.delete(assignments).where(inArray(assignments.id, current.map((a) => a.id)));
    await tx.insert(assignments).values({ userId, roleId: role.id, createdBy: actor.userId });
    await AuditService.recordInTx(tx, {
      action: AUDIT_ACTION.ASSIGNMENTS_CHANGED, outcome: 'SUCCESS',
      userId: actor.userId, ipAddress: actor.ipAddress ?? null,
      attributes: { targetUserId: userId, before, after: [{ role: roleName, scope: 'all' }] },
    });
    return before;
  }

  /**
   * Who can access `channelId` now (plan section 8): each enabled user whose
   * live assignments cover it, with the channel permissions those give and
   * through which role and scope; and who reaches every channel anyway, through
   * code they can change or deploy, or through data every channel shares.
   */
  static async channelAccess(reader: Reader, channelId: string): Promise<ChannelAccessView> {
    const [channel] = await reader.select({ id: channels.id }).from(channels).where(and(eq(channels.id, channelId), isNull(channels.deletedAt)));
    if (!channel) throw new ServiceError('NOT_FOUND', `Channel not found: ${channelId}`);
    const rows = await reader.select({
      id: assignments.id, userId: users.id, username: users.username, roleId: roles.id, role: roles.name, admin: roles.admin,
      allChannels: assignments.allChannels, expiresAt: assignments.expiresAt,
    }).from(assignments).innerJoin(users, eq(users.id, assignments.userId)).innerJoin(roles, eq(roles.id, assignments.roleId))
      .where(and(eq(users.enabled, true), isLiveAssignment()));
    const scoped = rows.filter((r) => !r.allChannels).map((r) => r.id);
    const groupRows = scoped.length === 0 ? [] : await reader.select({ assignmentId: assignmentGroups.assignmentId, groupId: assignmentGroups.channelGroupId })
      .from(assignmentGroups).where(inArray(assignmentGroups.assignmentId, scoped));
    const channelGroupIds = new Set((await reader.select({ groupId: channelGroupMembers.channelGroupId }).from(channelGroupMembers)
      .where(eq(channelGroupMembers.channelId, channelId))).map((r) => r.groupId));
    const perms = new Map<string, readonly Permission[]>();
    for (const r of rows) if (!perms.has(r.roleId)) perms.set(r.roleId, await permissionsOfRole(reader, { id: r.roleId, admin: r.admin }));

    const people = new Map<string, { userId: string; username: string; permissions: Set<string>; through: AccessPath[] }>();
    const code = new Map<string, string>();
    const shared = new Map<string, string>();
    for (const r of rows) {
      const held = perms.get(r.roleId) ?? [];
      if (held.some((p) => PERMISSION_CATALOG[p].runsCode)) code.set(r.userId, r.username);
      if (held.some((p) => PERMISSION_CATALOG[p].readsEveryChannel)) shared.set(r.userId, r.username);
      const groupIds = r.allChannels ? null : groupRows.filter((g) => g.assignmentId === r.id).map((g) => g.groupId).sort();
      if (groupIds !== null && !groupIds.some((g) => channelGroupIds.has(g))) continue;
      const onChannel = held.filter((p) => PERMISSION_CATALOG[p].class === PERMISSION_CLASS.CHANNEL);
      if (onChannel.length === 0) continue;
      const person = people.get(r.userId) ?? { userId: r.userId, username: r.username, permissions: new Set<string>(), through: [] };
      for (const p of onChannel) person.permissions.add(p);
      person.through.push({ role: r.role, permissions: [...onChannel].sort(), groupIds, expiresAt: r.expiresAt?.toISOString() ?? null });
      people.set(r.userId, person);
    }
    const byName = <T extends { username: string }>(a: T, b: T): number => a.username.localeCompare(b.username);
    const list = (m: Map<string, string>): Array<{ userId: string; username: string }> => [...m].map(([userId, username]) => ({ userId, username })).sort(byName);
    return {
      people: [...people.values()].map((p) => ({ ...p, permissions: [...p.permissions].sort() })).sort(byName),
      throughCode: list(code),
      throughSharedData: list(shared),
    };
  }

  /**
   * Add a channel to a group as a backup restore does, and record it like any
   * other membership change, in one transaction: who could reach what is
   * rebuilt from these rows.
   *
   * The channel row is locked first, as ChannelGroupService.setChannelGroups
   * locks it, so a restore and a save of the same channel's groups queue and
   * each records the before the other left. A deleted channel is NOT_FOUND.
   *
   * No grant rule applies: system:restore runs code (it can replace any
   * channel's scripts), so its holder already reaches every channel, and a
   * restore may give a group's members permissions on the channel that the
   * restorer does not hold themselves.
   */
  static async restoreMembership(channelId: string, groupId: string, actor: GrantActor): Promise<void> {
    await db.transaction(async (tx) => {
      const [channel] = await tx.select({ id: channels.id }).from(channels)
        .where(and(eq(channels.id, channelId), isNull(channels.deletedAt))).for('no key update');
      if (!channel) throw new ServiceError('NOT_FOUND', `Channel not found: ${channelId}`);
      const before = (await tx.select({ groupId: channelGroupMembers.channelGroupId }).from(channelGroupMembers)
        .where(eq(channelGroupMembers.channelId, channelId))).map((r) => r.groupId).sort();
      await tx.insert(channelGroupMembers).values({ channelGroupId: groupId, channelId });
      await AuditService.recordInTx(tx, {
        action: AUDIT_ACTION.CHANNEL_GROUPS_CHANGED, outcome: 'SUCCESS', userId: actor.userId, channelId, ipAddress: actor.ipAddress ?? null,
        attributes: { before, after: [...before, groupId].sort(), restored: true },
      });
    });
  }

  /** The groups a live assignment is scoped to: adding a channel to one gives access (D-310). */
  static async groupsGivingAccess(reader: Reader = db): Promise<ReadonlySet<string>> {
    const rows = await reader.select({ groupId: assignmentGroups.channelGroupId }).from(assignmentGroups)
      .innerJoin(assignments, eq(assignments.id, assignmentGroups.assignmentId))
      .where(isLiveAssignment());
    return new Set(rows.map((r) => r.groupId));
  }

  /** A user's assignments, live and expired, oldest first. */
  static listAssignments(reader: Reader, userId: string): Promise<readonly AssignmentView[]> {
    return assignmentsOf(reader, userId);
  }

  /**
   * Replace every assignment `userId` holds with `wanted`, and record it
   * (plan sections 1 and 5). Refused for the actor's own access, for a user
   * the actor could not act on (target rule), for a role or scope the actor
   * does not hold (within rule), for a scope the role cannot have, for the
   * Default group, for an expiry already past, and when it would leave no
   * lasting admin. Locks the admin role, then each role, then each group.
   */
  static async setAssignments(tx: AuditTransaction, userId: string, wanted: readonly AssignmentInput[], actor: GrantActor): Promise<readonly AssignmentView[]> {
    if (actor.userId === userId) throw new ServiceError('FORBIDDEN', 'You cannot change your own access');
    const adminRoleId = await lockAdminRole(tx);
    const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update');
    if (!target) throw new ServiceError('NOT_FOUND', `User not found: ${userId}`);
    const grants = await actorGrants(tx, actor.userId);
    await GrantService.assertCanManage(tx, actor.userId!, userId);
    const resolved = await resolveAssignments(tx, wanted, grants);
    const keepsAdmin = resolved.some((a) => a.role.id === adminRoleId && a.input.groupIds === null && a.expiresAt === null);
    if (!keepsAdmin && await holdsAdmin(tx, adminRoleId, userId) && (await otherLastingAdmins(tx, adminRoleId, userId)) === 0) {
      throw new ServiceError('CONFLICT', 'Cannot take the admin role from the last enabled admin user');
    }
    const before = await assignmentsOf(tx, userId);
    await tx.delete(assignments).where(eq(assignments.userId, userId));
    for (const a of resolved) {
      const [row] = await tx.insert(assignments).values({
        userId, roleId: a.role.id, allChannels: a.input.groupIds === null, expiresAt: a.expiresAt, reason: a.input.reason, createdBy: actor.userId,
      }).returning({ id: assignments.id });
      if (a.input.groupIds !== null) await tx.insert(assignmentGroups).values(a.input.groupIds.map((channelGroupId) => ({ assignmentId: row!.id, channelGroupId })));
    }
    const after = await assignmentsOf(tx, userId);
    const summary = (list: readonly AssignmentView[]): unknown[] => list.map((a) => ({ role: a.roleName, scope: a.groupIds ?? 'all', expiresAt: a.expiresAt, reason: a.reason }));
    await AuditService.recordInTx(tx, {
      action: AUDIT_ACTION.ASSIGNMENTS_CHANGED, outcome: 'SUCCESS', userId: actor.userId, ipAddress: actor.ipAddress ?? null,
      attributes: { targetUserId: userId, before: summary(before), after: summary(after) },
    });
    return after;
  }

  /**
   * Replace a channel's group memberships and record the change, in the
   * caller's transaction (D-310, plan section 2). Adding a channel to a group is
   * a grant: everyone the group's live assignments cover gains those
   * permissions on the channel, so the actor must already hold every one of
   * them on that channel. Removing a channel from a group narrows access and
   * needs only the channel route's own channels:write. Returns the groups before.
   */
  static async applyChannelGroups(tx: AuditTransaction, channelId: string, wanted: readonly string[], actor: GrantActor): Promise<readonly string[]> {
    const before = (await tx.select({ groupId: channelGroupMembers.channelGroupId }).from(channelGroupMembers)
      .where(eq(channelGroupMembers.channelId, channelId))).map((r) => r.groupId);
    const added = wanted.filter((g) => !before.includes(g)).sort();
    if (added.length > 0) {
      // FOR SHARE in id order before reading what the groups grant: an
      // assignment writer holds FOR UPDATE on its groups, so the two queue and
      // this check never misses an assignment committed meanwhile.
      await tx.select({ id: channelGroups.id }).from(channelGroups).where(inArray(channelGroups.id, added)).orderBy(asc(channelGroups.id)).for('share');
      const granted = await permissionsGrantedThrough(tx, added);
      const held = actor.userId === null ? undefined : await queryUserStanding(tx, actor.userId);
      const groupIds = before as ChannelGroupId[];
      const missing = granted.filter((p) => !(held?.enabled === true && can(held.grants, p, { groupIds }))).sort();
      if (missing.length > 0) {
        throw new ServiceError('FORBIDDEN', `Adding this channel to that group gives its members permissions you do not hold on the channel: ${missing.join(', ')}`, { missing });
      }
    }
    await tx.delete(channelGroupMembers).where(eq(channelGroupMembers.channelId, channelId));
    // In id order, so the foreign-key locks queue in the same order as the assignment writer's.
    if (wanted.length > 0) await tx.insert(channelGroupMembers).values([...wanted].sort().map((channelGroupId) => ({ channelGroupId, channelId })));
    await AuditService.recordInTx(tx, {
      action: AUDIT_ACTION.CHANNEL_GROUPS_CHANGED, outcome: 'SUCCESS', userId: actor.userId, channelId, ipAddress: actor.ipAddress ?? null,
      attributes: { before: [...before].sort(), after: [...wanted].sort() },
    });
    return before;
  }

  /**
   * The group a new channel of `actor`'s joins, by the rules of
   * `placeNewChannel`, or null; FORBIDDEN, INVALID_INPUT or NOT_FOUND when it
   * has none. Inside a transaction the group row is locked FOR KEY SHARE, so a
   * group deleted at the same time waits for the insert, or is gone here. An
   * import calls it once before its first channel, so a bad group fails the
   * request rather than every channel in it.
   */
  static async newChannelGroup(reader: Reader, groupId: string | undefined, actor: GrantActor): Promise<string | null> {
    const standing = actor.userId === null ? null : await queryUserStanding(reader, actor.userId);
    const scope = standing?.enabled === true ? standing.grants.get(PERMISSIONS.CHANNELS_WRITE) : undefined;
    if (scope === undefined) throw new ServiceError('FORBIDDEN', 'Creating a channel needs channels:write');
    const target = scope === ALL_CHANNELS ? groupId ?? await defaultGroupId(reader) : scopedTarget(scope, groupId);
    if (target === null) return null;
    const [found] = await reader.select({ id: channelGroups.id }).from(channelGroups).where(eq(channelGroups.id, target)).for('key share');
    if (!found) throw new ServiceError('NOT_FOUND', `Channel group not found: ${target}`);
    return target;
  }

  /**
   * Put a channel created in this transaction into a group, and record it
   * (D-310, plan section 2). A new channel has no access to give away yet, so
   * this is not judged as a grant: the group must be inside the creator's
   * channels:write scope, which keeps the channel in their own reach.
   * - An all-channel writer's channel joins `groupId`, or Default when none is
   *   named (none at all when there is no Default group).
   * - A scoped writer's joins `groupId`, which must be one of their write
   *   groups, or their only write group; with several they must name one.
   * Returns the group joined, or null.
   */
  static async placeNewChannel(tx: AuditTransaction, channelId: string, groupId: string | undefined, actor: GrantActor): Promise<string | null> {
    const target = await GrantService.newChannelGroup(tx, groupId, actor);
    if (target === null) return null;
    await tx.insert(channelGroupMembers).values({ channelGroupId: target, channelId });
    await AuditService.recordInTx(tx, {
      action: AUDIT_ACTION.CHANNEL_GROUPS_CHANGED, outcome: 'SUCCESS', userId: actor.userId, channelId, ipAddress: actor.ipAddress ?? null,
      attributes: { before: [], after: [target], created: true },
    });
    return target;
  }

  /**
   * The target rule: refuse unless every permission `targetId` holds is one
   * `actorId` holds too. Acting on a user (editing, disabling, deleting,
   * resetting their password, unlocking) needs it.
   */
  static async assertCanManage(reader: Reader, actorId: string, targetId: string): Promise<void> {
    const target = await queryUserStanding(reader, targetId);
    if (!target) throw new ServiceError('NOT_FOUND', `User not found: ${targetId}`);
    // Scope-aware: each permission over the target's scope for it, so holding
    // a permission on one group does not reach someone who holds it on all.
    const grants = await actorGrants(reader, actorId);
    const missing = [...target.grants.entries()]
      .filter(([p, scope]) => !holdsOver(grants, p, scope === ALL_CHANNELS ? null : [...scope]))
      .map(([p]) => p).sort();
    if (missing.length > 0) {
      throw new ServiceError('FORBIDDEN', `You can only manage users whose access is within your own. Missing: ${missing.join(', ')}`, { missing });
    }
  }

  /** Every role with its permissions and how many users hold it, by name. */
  static async listRoles(reader: Reader = db): Promise<readonly RoleSummary[]> {
    const rows = await reader.select().from(roles).orderBy(asc(roles.name));
    const perms = await reader.select().from(rolePermissions);
    const counts = await reader
      .select({ roleId: assignments.roleId, n: sql<number>`count(DISTINCT ${assignments.userId})::int` })
      .from(assignments).where(isLiveAssignment()).groupBy(assignments.roleId);
    const known = new Set<string>(ALL_PERMISSIONS);
    return rows.map((r) => ({
      id: r.id, name: r.name, description: r.description, builtIn: r.builtIn, admin: r.admin,
      permissions: r.admin ? ALL_PERMISSIONS : perms.filter((p) => p.roleId === r.id && known.has(p.permission)).map((p) => p.permission as Permission).sort(),
      holders: counts.find((c) => c.roleId === r.id)?.n ?? 0,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }));
  }

  /** One role, or NOT_FOUND. */
  static async getRole(id: string, reader: Reader = db): Promise<RoleSummary> {
    const role = (await GrantService.listRoles(reader)).find((r) => r.id === id);
    if (!role) throw new ServiceError('NOT_FOUND', `Role not found: ${id}`);
    return role;
  }

  /** Create a role, or a clone of one, within what the actor holds. */
  static async createRole(tx: AuditTransaction, input: CreateRoleInput, actor: GrantActor): Promise<string> {
    await assertWithin(tx, actor.userId, input.permissions, 'create a role');
    await assertNameFree(tx, input.name);
    if (input.clonedFrom !== undefined) {
      const [source] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, input.clonedFrom));
      if (!source) throw new ServiceError('INVALID_INPUT', `No role to clone: ${input.clonedFrom}`);
    }
    const [row] = await tx.insert(roles).values({ name: input.name, description: input.description }).returning({ id: roles.id })
      .catch((err: unknown) => { throw asConflict(err); });
    if (!row) throw new ServiceError('INTERNAL', 'Failed to create role');
    if (input.permissions.length > 0) {
      await tx.insert(rolePermissions).values(input.permissions.map((permission) => ({ roleId: row.id, permission })));
    }
    await AuditService.recordInTx(tx, {
      action: AUDIT_ACTION.ROLE_CREATED, outcome: 'SUCCESS', userId: actor.userId, ipAddress: actor.ipAddress ?? null,
      attributes: { roleId: row.id, name: input.name, permissions: [...input.permissions].sort(), ...(input.clonedFrom ? { clonedFrom: input.clonedFrom } : {}) },
    });
    return row.id;
  }

  /**
   * Change a role's name, description or permissions. Every added permission
   * must be one the actor holds, and every holder one the actor could act on.
   * The admin role is locked.
   */
  static async updateRole(tx: AuditTransaction, id: string, input: UpdateRoleInput, actor: GrantActor): Promise<void> {
    const role = await lockRole(tx, id);
    if (role.admin) throw new ServiceError('SYSTEM_PROTECTED', 'The admin role cannot be changed');
    await assertCanManageHolders(tx, id, actor.userId);
    const before = await permissionsOfRole(tx, role);
    const after = input.permissions ? [...input.permissions].sort() : before;
    await assertRoleEditWithin(tx, id, after.filter((p) => !before.includes(p)), actor.userId);
    if (input.name !== undefined) await assertNameFree(tx, input.name, id);
    await tx.update(roles).set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      updatedAt: new Date(),
    }).where(eq(roles.id, id)).catch((err: unknown) => { throw asConflict(err); });
    if (input.permissions) {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      if (after.length > 0) await tx.insert(rolePermissions).values(after.map((permission) => ({ roleId: id, permission })));
    }
    await AuditService.recordInTx(tx, {
      action: AUDIT_ACTION.ROLE_UPDATED, outcome: 'SUCCESS', userId: actor.userId, ipAddress: actor.ipAddress ?? null,
      attributes: { roleId: id, before: { name: role.name, permissions: before }, after: { name: input.name ?? role.name, permissions: after } },
    });
  }

  /** Delete a role nobody is assigned, live or expired. The admin role is locked. */
  static async deleteRole(tx: AuditTransaction, id: string, actor: GrantActor): Promise<void> {
    const role = await lockRole(tx, id);
    if (role.admin) throw new ServiceError('SYSTEM_PROTECTED', 'The admin role cannot be deleted');
    const held = await tx.select({ assignmentId: assignments.id, userId: users.id, username: users.username, expiresAt: assignments.expiresAt })
      .from(assignments).innerJoin(users, eq(users.id, assignments.userId)).where(eq(assignments.roleId, id)).orderBy(asc(users.username));
    if (held.length > 0) {
      throw new ServiceError('CONFLICT', `The role is assigned ${String(held.length)} time(s); remove those assignments first`, { assignments: held });
    }
    await tx.delete(roles).where(eq(roles.id, id)).catch((err: unknown) => { throw asConflict(err); });
    await AuditService.recordInTx(tx, {
      action: AUDIT_ACTION.ROLE_DELETED, outcome: 'SUCCESS', userId: actor.userId, ipAddress: actor.ipAddress ?? null,
      attributes: { roleId: id, name: role.name },
    });
  }
}
