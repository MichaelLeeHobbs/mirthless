import { hashPassword, verifyPassword } from '../lib/password.js';
import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, ne, asc, type SQL } from 'drizzle-orm';
import type { AssignmentInput, AssignmentView, CreateUserInput, UpdateUserInput } from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { uniqueConstraint } from '../lib/pg-error.js';
import { heldRoleNamesSql, loadUserStanding, roleLabel } from '../lib/principal.js';
import { db } from '../lib/db.js';
import { users, sessions } from '../db/schema/index.js';
import { GrantService, lockAccessFor, type GrantActor } from './grant.service.js';
import { AUDIT_ACTION, PERMISSIONS, USER_KIND, type TakenOverKey } from '@galvanigraph/core-models';
import { ApiKeyService } from './api-key.service.js';
import { AuditService } from './audit.service.js';

type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DETAILS = ['email', 'firstName', 'lastName'] as const;
type UserDetails = { readonly [K in (typeof DETAILS)[number]]: string | null };

async function revokeSessions(tx: DbExecutor, userId: string): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
}

/** A person, not the principal behind an API key, which is managed with its key (D-313). */
function isPerson(): SQL {
  return eq(users.kind, USER_KIND.PERSON);
}

/**
 * FOR NO KEY UPDATE serialises changes to one user without blocking inserts
 * whose foreign keys point at the row (sessions, events).
 */
async function lockTarget(tx: DbExecutor, id: string): Promise<UserDetails & { readonly enabled: boolean }> {
  const [row] = await tx.select({ enabled: users.enabled, email: users.email, firstName: users.firstName, lastName: users.lastName })
    .from(users).where(and(eq(users.id, id), isPerson())).for('no key update');
  if (!row) {
    throw new ServiceError('NOT_FOUND', `User not found: ${id}`);
  }
  return row;
}

/** A deleted account is a disabled one, and what the audit log says of its person must stay theirs (D-372). */
function assertKeepsEmail(target: UserDetails & { readonly enabled: boolean }, input: UpdateUserInput): void {
  const staysDisabled = !target.enabled && input.enabled !== true;
  if (staysDisabled && input.email !== undefined && input.email !== target.email) {
    throw new ServiceError('CONFLICT', 'The email of a disabled account cannot be changed. Enable the account first.');
  }
}

async function recordDetailChanges(tx: DbExecutor, id: string, before: UserDetails, input: UpdateUserInput, actor: GrantActor): Promise<void> {
  const changed = DETAILS.filter((detail) => input[detail] !== undefined && input[detail] !== before[detail]);
  if (changed.length === 0) return;
  const valuesOf = (from: UserDetails | UpdateUserInput): Record<string, unknown> => Object.fromEntries(changed.map((detail) => [detail, from[detail]]));
  await AuditService.recordInTx(tx, {
    action: AUDIT_ACTION.USER_DETAILS_CHANGED, outcome: 'SUCCESS', userId: actor.userId, ipAddress: actor.ipAddress ?? null,
    attributes: { targetUserId: id, before: valuesOf(before), after: valuesOf(input) },
  });
}

function usernameTaken(username: string): ServiceError {
  return new ServiceError('ALREADY_EXISTS', `Username already taken: ${username}`);
}

function emailTaken(email: string): ServiceError {
  return new ServiceError('ALREADY_EXISTS', `Email already in use: ${email}`);
}

/** A name another account has, as the answer the checks before a write give: two writes at once can both pass those. */
function asTaken(err: unknown, sent: { readonly username?: string; readonly email?: string | undefined }): unknown {
  const constraint = uniqueConstraint(err);
  if (constraint === users.username.uniqueName && sent.username !== undefined) return usernameTaken(sent.username);
  if (constraint === users.email.uniqueName && sent.email !== undefined) return emailTaken(sent.email);
  return err;
}

function withRoles<T extends { readonly roleNames: readonly string[] }>(row: T): Omit<T, 'roleNames'> & { readonly role: string; readonly roles: readonly string[] } {
  const { roleNames, ...rest } = row;
  return { ...rest, role: roleLabel(roleNames), roles: roleNames };
}

function userUpdates(input: UpdateUserInput): Record<string, unknown> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.email !== undefined) updates['email'] = input.email;
  if (input.firstName !== undefined) updates['firstName'] = input.firstName;
  if (input.lastName !== undefined) updates['lastName'] = input.lastName;
  if (input.enabled !== undefined) updates['enabled'] = input.enabled;
  return updates;
}

export interface UserSummary {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly role: string;
  readonly roles: readonly string[];
  readonly enabled: boolean;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
}

export interface UserDetail extends UserSummary {
  readonly description: string | null;
  readonly failedLoginAttempts: number;
  readonly lockedUntil: Date | null;
  readonly updatedAt: Date;
}

export class UserService {
  /** Never includes passwords. */
  static async listUsers(): Promise<Result<readonly UserSummary[]>> {
    return tryCatch(async () => {
      const rows = await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          roleNames: heldRoleNamesSql(),
          enabled: users.enabled,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(isPerson())
        .orderBy(asc(users.username));

      return rows.map(withRoles);
    });
  }

  static async getUser(id: string): Promise<Result<UserDetail>> {
    return tryCatch(async () => {
      const [user] = await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          description: users.description,
          roleNames: heldRoleNamesSql(),
          enabled: users.enabled,
          lastLoginAt: users.lastLoginAt,
          failedLoginAttempts: users.failedLoginAttempts,
          lockedUntil: users.lockedUntil,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(and(eq(users.id, id), isPerson()));

      if (!user) {
        throw new ServiceError('NOT_FOUND', `User not found: ${id}`);
      }

      return withRoles(user);
    });
  }

  static async createUser(input: CreateUserInput, context?: AuditContext): Promise<Result<UserDetail>> {
    return tryCatch(async () => {
      const [existingUsername] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, input.username));

      if (existingUsername) {
        throw usernameTaken(input.username);
      }

      const [existingEmail] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email));

      if (existingEmail) {
        throw emailTaken(input.email);
      }

      const passwordHash = await hashPassword(input.password);
      const role = input.role ?? 'viewer';

      // The user and their one all-channel assignment commit together, with
      // the assignment's audit row (grant.service).
      const createdId = await db.transaction(async (tx) => {
        // Before the insert: an email change waits on its unique entry while holding this lock.
        await lockAccessFor(tx, context?.userId ?? null, PERMISSIONS.USERS_WRITE);
        const [row] = await tx
          .insert(users)
          .values({
            username: input.username,
            email: input.email,
            passwordHash,
            ...(input.firstName != null ? { firstName: input.firstName } : {}),
            ...(input.lastName != null ? { lastName: input.lastName } : {}),
          })
          .returning({ id: users.id })
          .catch((err: unknown) => { throw asTaken(err, input); });

        if (!row) {
          throw new ServiceError('INTERNAL', 'Failed to create user');
        }
        await GrantService.setUserRole(tx, row.id, role, { userId: context?.userId ?? null, ipAddress: context?.ipAddress ?? null });
        return row.id;
      });

      const created = await this.getUser(createdId);
      if (!created.ok) throw created.error;

      emitEvent({
        level: 'INFO', name: 'USER_CREATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { createdUserId: createdId, username: input.username },
      });

      return created.value;
    });
  }

  static async updateUser(id: string, input: UpdateUserInput, actorId: string, context?: AuditContext): Promise<Result<UserDetail>> {
    return tryCatch(async () => {
      const beingDisabled = input.enabled === false;

      const actor = { userId: context?.userId ?? actorId, ipAddress: context?.ipAddress ?? null };
      const oldRoles = await db.transaction(async (tx) => {
        // First (grant.service), so what the actor and the target hold stays as checked.
        await lockAccessFor(tx, actorId, PERMISSIONS.USERS_WRITE);
        if (id === actorId && beingDisabled) {
          throw new ServiceError('SELF_ACTION', 'Cannot disable your own account');
        }
        if (id === actorId && input.role !== undefined) {
          const current = await GrantService.heldRoleNames(tx, id);
          if (!(current.length === 1 && current[0] === input.role)) {
            throw new ServiceError('SELF_ACTION', 'Cannot change your own role');
          }
        }
        await GrantService.assertCanManage(tx, actorId, id);
        if (beingDisabled || input.role !== undefined) {
          await GrantService.assertKeepsAnAdmin(tx, {
            userId: id, disabling: beingDisabled, ...(input.role !== undefined ? { newRoleName: input.role } : {}),
          });
        }
        const target = await lockTarget(tx, id);
        assertKeepsEmail(target, input);
        if (input.enabled === true && !target.enabled) await GrantService.assertCanManageToTheEnd(tx, actorId, id);
        await tx.update(users).set(userUpdates(input)).where(eq(users.id, id))
          .catch((err: unknown) => { throw asTaken(err, input); });
        await recordDetailChanges(tx, id, target, input, actor);
        // Who could act is replayed from the audit log (grant.service channelAccessAsOf).
        if (input.enabled !== undefined && input.enabled !== target.enabled) {
          await GrantService.recordEnabledChange(tx, id, input.enabled, actor);
          // The keys this user issued stop with them: they know the secrets (D-322).
          if (!input.enabled) await GrantService.offboardKeys(tx, id, actor);
        }
        const before = input.role !== undefined ? await GrantService.setUserRole(tx, id, input.role, actor) : null;

        // Disabling a user must revoke their sessions — otherwise a disabled user
        // keeps a valid refresh token and can rotate indefinitely.
        if (beingDisabled) {
          await revokeSessions(tx, id);
        }
        return before;
      });
      const oldRole = oldRoles === null ? null : roleLabel(oldRoles);
      const roleChanged = oldRole !== null && oldRole !== input.role;

      const result = await this.getUser(id);
      if (!result.ok) throw result.error;

      emitEvent({
        // A privilege (role) or enabled change is security-relevant — log it at WARN
        // with the before/after so the audit trail records who escalated whom.
        level: roleChanged || input.enabled !== undefined ? 'WARN' : 'INFO',
        name: 'USER_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: {
          updatedUserId: id,
          ...(roleChanged ? { oldRole, newRole: input.role } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      });

      return result.value;
    });
  }

  /**
   * Soft delete: disables the user. Every working API key the user issued is
   * disabled with it (D-322), except those in `takeOwnership`: each is replaced
   * as a leak, issued to the actor, and its new token returned once.
   */
  static async deleteUser(id: string, actorId: string, context?: AuditContext, takeOwnership: readonly string[] = []): Promise<Result<readonly TakenOverKey[]>> {
    return tryCatch(async () => {
      if (id === actorId) {
        throw new ServiceError('SELF_ACTION', 'Cannot delete your own account');
      }

      const taken = await db.transaction(async (tx) => {
        await lockAccessFor(tx, actorId, PERMISSIONS.USERS_DELETE);
        await GrantService.assertCanManage(tx, actorId, id);
        // Cannot remove the last ENABLED admin: a disabled admin does not count.
        await GrantService.assertKeepsAnAdmin(tx, { userId: id, disabling: true });
        const target = await lockTarget(tx, id);

        await tx
          .update(users)
          .set({ enabled: false, updatedAt: new Date() })
          .where(eq(users.id, id));
        const actor = { userId: context?.userId ?? actorId, ipAddress: context?.ipAddress ?? null };
        const takenOver: TakenOverKey[] = [];
        // Taken over first, so they are the actor's when the rest are disabled.
        const toTake = [...new Set(takeOwnership)].sort();
        if (toTake.length > 0) await ApiKeyService.lockForTakeover(tx, toTake);
        for (const keyId of toTake) {
          const next = await ApiKeyService.replaceInTx(tx, keyId, 'leak', actor, id);
          takenOver.push({ keyId, name: next.name, token: next.token });
        }
        if (target.enabled) await GrantService.recordEnabledChange(tx, id, false, actor);
        await GrantService.offboardKeys(tx, id, actor, takenOver.map((k) => k.keyId));
        await revokeSessions(tx, id);
        return takenOver;
      });

      emitEvent({
        level: 'INFO', name: 'USER_DELETED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { deletedUserId: id },
      });
      return taken;
    });
  }

  /** Resets another user's password. Your own needs the current one (`changeOwnPassword`). */
  static async changePassword(id: string, newPassword: string, actorId: string): Promise<Result<void>> {
    return tryCatch(async () => {
      if (id === actorId) {
        throw new ServiceError('SELF_ACTION', 'Cannot reset your own password. Use Change Password, which asks for the current one');
      }
      await GrantService.assertCanManage(db, actorId, id);

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, id), isPerson()));

      if (!user) {
        throw new ServiceError('NOT_FOUND', `User not found: ${id}`);
      }

      const passwordHash = await hashPassword(newPassword);

      // Revoke the sessions too, so stolen tokens for the account stop working.
      await db.transaction(async (tx) => {
        // Hashing takes long enough for either's access to have changed since the first check.
        await lockAccessFor(tx, actorId, PERMISSIONS.USERS_WRITE);
        await GrantService.assertCanManageToTheEnd(tx, actorId, id);
        await tx
          .update(users)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(users.id, id));
        await revokeSessions(tx, id);
      });

      emitEvent({
        level: 'WARN', name: 'PASSWORD_CHANGED', outcome: 'SUCCESS',
        userId: actorId, channelId: null, serverId: null, ipAddress: null,
        attributes: { targetUserId: id, adminReset: true },
      });
    });
  }

  /** Revokes every session but `currentSessionId`, so the caller stays logged in. */
  static async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionId?: string,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const [user] = await db
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        throw new ServiceError('NOT_FOUND', `User not found: ${userId}`);
      }

      const valid = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        throw new ServiceError('INVALID_CREDENTIALS', 'Current password is incorrect');
      }

      const passwordHash = await hashPassword(newPassword);

      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
          .where(eq(users.id, userId));

        if (currentSessionId !== undefined) {
          await tx
            .delete(sessions)
            .where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)));
        } else {
          await revokeSessions(tx, userId);
        }
      });

      emitEvent({
        level: 'INFO', name: 'PASSWORD_CHANGED', outcome: 'SUCCESS',
        userId, channelId: null, serverId: null, ipAddress: null,
        attributes: { self: true },
      });
    });
  }

  static async getPermissions(id: string): Promise<Result<{ readonly role: string; readonly roles: readonly string[]; readonly permissions: readonly string[] }>> {
    return tryCatch(async () => {
      const [person] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), isPerson()));
      const standing = person ? await loadUserStanding(id) : null;
      if (!standing) {
        throw new ServiceError('NOT_FOUND', `User not found: ${id}`);
      }

      return { role: roleLabel(standing.roles), roles: standing.roles, permissions: standing.permissions };
    });
  }

  static async getAssignments(id: string): Promise<Result<readonly AssignmentView[]>> {
    return tryCatch(async () => {
      const [user] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), isPerson()));
      if (!user) throw new ServiceError('NOT_FOUND', `User not found: ${id}`);
      return GrantService.listAssignments(db, id);
    });
  }

  static async setAssignments(id: string, wanted: readonly AssignmentInput[], context: AuditContext): Promise<Result<readonly AssignmentView[]>> {
    return tryCatch(async () => db.transaction(async (tx) => GrantService.setAssignments(tx, id, wanted, {
      userId: context.userId ?? null, ipAddress: context.ipAddress ?? null,
    })));
  }

  static async unlockUser(id: string, actorId: string): Promise<Result<void>> {
    return tryCatch(async () => {
      await GrantService.assertCanManage(db, actorId, id);
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, id), isPerson()));

      if (!user) {
        throw new ServiceError('NOT_FOUND', `User not found: ${id}`);
      }

      await db
        .update(users)
        .set({
          failedLoginAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id));
    });
  }
}
