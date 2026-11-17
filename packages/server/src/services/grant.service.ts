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
// Anti-escalation (plan section 5), while every assignment covers all channels:
// - within rule: an actor may assign a role, or add a permission to a role,
//   only when they hold every permission it gives;
// - target rule: an actor may act on a user only when that user's permissions
//   are all among the actor's own;
// - nobody changes their own role (user.service), and the admin role is locked.

import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { AUDIT_ACTION, PERMISSIONS, type CreateRoleInput, type Permission, type UpdateRoleInput } from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { isLiveAssignment, queryUserStanding } from '../lib/principal.js';
import { db } from '../lib/db.js';
import { assignments, rolePermissions, roles, users } from '../db/schema/index.js';
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
    const before = await heldRoleNames(tx, userId);
    if (before.length === 1 && before[0] === roleName) return before;
    await assertWithin(tx, actor.userId, await permissionsOfRole(tx, role), 'assign a role');
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
   * The target rule: refuse unless every permission `targetId` holds is one
   * `actorId` holds too. Acting on a user (editing, disabling, deleting,
   * resetting their password, unlocking) needs it.
   */
  static async assertCanManage(reader: Reader, actorId: string, targetId: string): Promise<void> {
    const target = await queryUserStanding(reader, targetId);
    if (!target) throw new ServiceError('NOT_FOUND', `User not found: ${targetId}`);
    await assertWithin(reader, actorId, target.permissions, 'manage users');
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
    await assertWithin(tx, actor.userId, after.filter((p) => !before.includes(p)), 'add permissions to a role');
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
