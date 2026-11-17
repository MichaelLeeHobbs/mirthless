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

import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { AUDIT_ACTION } from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { isLiveAssignment } from '../lib/principal.js';
import { assignments, roles, users } from '../db/schema/index.js';
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

/** The role named `name`, or an INVALID_INPUT error. */
async function roleByName(tx: AuditTransaction, name: string): Promise<{ readonly id: string; readonly admin: boolean }> {
  const [row] = await tx.select({ id: roles.id, admin: roles.admin }).from(roles).where(eq(roles.name, name));
  if (!row) throw new ServiceError('INVALID_INPUT', `No role is named ${name}`);
  return row;
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
}
