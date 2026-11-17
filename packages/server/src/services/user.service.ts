// ===========================================
// User Service
// ===========================================
// CRUD operations for user management.
// All methods return Result<T> using tryCatch from stderr-lib.

import bcrypt from 'bcryptjs';
import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, ne, asc, type SQL } from 'drizzle-orm';
import type { AssignmentInput, AssignmentView, CreateUserInput, UpdateUserInput } from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { heldRoleNamesSql, loadUserStanding, roleLabel } from '../lib/principal.js';
import { db } from '../lib/db.js';
import { users, sessions } from '../db/schema/index.js';
import { GrantService } from './grant.service.js';
import { USER_KIND, type TakenOverKey } from '@galvanigraph/core-models';
import { ApiKeyService } from './api-key.service.js';

const BCRYPT_ROUNDS = 12;

/** Drizzle transaction/executor type (db and tx both satisfy this). */
type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Revoke every active session for a user (forces re-login). */
async function revokeSessions(tx: DbExecutor, userId: string): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
}

/** A person, not the principal behind an API key, which is managed with its key (D-313). */
function isPerson(): SQL {
  return eq(users.kind, USER_KIND.PERSON);
}

/**
 * Lock the target user's row for the rest of the transaction, or NOT_FOUND.
 * FOR NO KEY UPDATE serialises changes to one user without blocking inserts
 * whose foreign keys point at the row (sessions, events). Never a key's user.
 */
async function lockTarget(tx: DbExecutor, id: string): Promise<{ readonly enabled: boolean }> {
  const [row] = await tx.select({ enabled: users.enabled }).from(users).where(and(eq(users.id, id), isPerson())).for('no key update');
  if (!row) {
    throw new ServiceError('NOT_FOUND', `User not found: ${id}`);
  }
  return row;
}

/** A row with its held role names, as the API shows it: `role` is the names joined, `roles` the list. */
function withRoles<T extends { readonly roleNames: readonly string[] }>(row: T): Omit<T, 'roleNames'> & { readonly role: string; readonly roles: readonly string[] } {
  const { roleNames, ...rest } = row;
  return { ...rest, role: roleLabel(roleNames), roles: roleNames };
}

/** The columns an update request changes, plus the update time. */
function userUpdates(input: UpdateUserInput): Record<string, unknown> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.email !== undefined) updates['email'] = input.email;
  if (input.firstName !== undefined) updates['firstName'] = input.firstName;
  if (input.lastName !== undefined) updates['lastName'] = input.lastName;
  if (input.enabled !== undefined) updates['enabled'] = input.enabled;
  return updates;
}

// ----- Response Types -----

export interface UserSummary {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  /** The held role names joined, for screens that show one role. */
  readonly role: string;
  /** The role names the user holds through live assignments, sorted. */
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

// ----- Service -----

export class UserService {
  /** List all users, ordered by username. Never includes passwords. */
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

  /** Get a single user's full detail. */
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

  /** Create a new user. Hashes the password. */
  static async createUser(input: CreateUserInput, context?: AuditContext): Promise<Result<UserDetail>> {
    return tryCatch(async () => {
      // Check username uniqueness
      const [existingUsername] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, input.username));

      if (existingUsername) {
        throw new ServiceError('ALREADY_EXISTS', `Username already taken: ${input.username}`);
      }

      // Check email uniqueness
      const [existingEmail] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email));

      if (existingEmail) {
        throw new ServiceError('ALREADY_EXISTS', `Email already in use: ${input.email}`);
      }

      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
      const role = input.role ?? 'viewer';

      // The user and their one all-channel assignment commit together, with
      // the assignment's audit row (grant.service).
      const createdId = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            username: input.username,
            email: input.email,
            passwordHash,
            ...(input.firstName != null ? { firstName: input.firstName } : {}),
            ...(input.lastName != null ? { lastName: input.lastName } : {}),
          })
          .returning({ id: users.id });

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

  /** Update user fields. Admin-only. Cannot change own role. */
  static async updateUser(id: string, input: UpdateUserInput, actorId: string, context?: AuditContext): Promise<Result<UserDetail>> {
    return tryCatch(async () => {
      const beingDisabled = input.enabled === false;

      const actor = { userId: context?.userId ?? actorId, ipAddress: context?.ipAddress ?? null };
      const oldRoles = await db.transaction(async (tx) => {
        // The admin role lock comes first, before the user row lock, in every
        // path that can remove an admin (grant.service), so concurrent changes
        // queue and each sees the last one's result.
        if (id === actorId && input.role !== undefined) {
          const current = await GrantService.heldRoleNames(tx, id);
          if (!(current.length === 1 && current[0] === input.role)) {
            throw new ServiceError('SELF_ACTION', 'Cannot change your own role');
          }
        }
        // The target rule: only a user whose access is within the actor's own.
        await GrantService.assertCanManage(tx, actorId, id);
        if (beingDisabled || input.role !== undefined) {
          await GrantService.assertKeepsAnAdmin(tx, {
            userId: id, disabling: beingDisabled, ...(input.role !== undefined ? { newRoleName: input.role } : {}),
          });
        }
        const target = await lockTarget(tx, id);
        await tx.update(users).set(userUpdates(input)).where(eq(users.id, id));
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

      // Fetch and return updated user
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
   * Soft-delete: disable user. Cannot delete self or last admin. Every working
   * API key the user issued is disabled in the same transaction (D-322),
   * except those in `takeOwnership`: each of those is replaced as a leak by
   * the actor, who becomes its issuer and must cover it, and its new token is
   * returned, once.
   */
  static async deleteUser(id: string, actorId: string, context?: AuditContext, takeOwnership: readonly string[] = []): Promise<Result<readonly TakenOverKey[]>> {
    return tryCatch(async () => {
      if (id === actorId) {
        throw new ServiceError('SELF_ACTION', 'Cannot delete your own account');
      }

      const taken = await db.transaction(async (tx) => {
        // Cannot remove the last ENABLED admin: a disabled admin does not count.
        await GrantService.assertCanManage(tx, actorId, id);
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
        if (toTake.length > 0) await ApiKeyService.lockForTakeover(tx, toTake, actorId);
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

  /** Change a user's password. Only an actor who may manage users may change another's. */
  static async changePassword(id: string, newPassword: string, actorId: string, actorMayManageUsers: boolean): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!actorMayManageUsers && id !== actorId) {
        throw new ServiceError('FORBIDDEN', 'Cannot change another user\'s password');
      }
      if (id !== actorId) {
        await GrantService.assertCanManage(db, actorId, id);
      }

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, id), isPerson()));

      if (!user) {
        throw new ServiceError('NOT_FOUND', `User not found: ${id}`);
      }

      const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

      // Admin reset: change the hash and revoke the target user's sessions so any
      // stolen tokens for that account are invalidated.
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(users.id, id));
        await revokeSessions(tx, id);
      });

      emitEvent({
        level: 'WARN', name: 'PASSWORD_CHANGED', outcome: 'SUCCESS',
        userId: actorId, channelId: null, serverId: null, ipAddress: null,
        attributes: { targetUserId: id, adminReset: id !== actorId },
      });
    });
  }

  /**
   * Self-service password change. Verifies the caller's CURRENT password, applies
   * the new hash, clears any forced-change flag, and invalidates all OTHER sessions
   * (the current one is preserved so the caller stays logged in).
   */
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

      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        throw new ServiceError('INVALID_CREDENTIALS', 'Current password is incorrect');
      }

      const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
          .where(eq(users.id, userId));

        // Invalidate every OTHER session; keep the caller's current session.
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

  /** Effective permission names for a user, resolved from their live assignments. */
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

  /** A user's assignments, live and expired; NOT_FOUND for no such user. */
  static async getAssignments(id: string): Promise<Result<readonly AssignmentView[]>> {
    return tryCatch(async () => {
      const [user] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), isPerson()));
      if (!user) throw new ServiceError('NOT_FOUND', `User not found: ${id}`);
      return GrantService.listAssignments(db, id);
    });
  }

  /** Replace a user's assignments through the grant service, which judges and records the change. */
  static async setAssignments(id: string, wanted: readonly AssignmentInput[], context: AuditContext): Promise<Result<readonly AssignmentView[]>> {
    return tryCatch(async () => db.transaction(async (tx) => GrantService.setAssignments(tx, id, wanted, {
      userId: context.userId ?? null, ipAddress: context.ipAddress ?? null,
    })));
  }

  /** Unlock a locked account. Resets failed attempts and lockout. */
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
