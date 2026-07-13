// ===========================================
// User Service
// ===========================================
// CRUD operations for user management.
// All methods return Result<T> using tryCatch from stderr-lib.

import bcrypt from 'bcryptjs';
import { tryCatch, type Result } from 'stderr-lib';
import { eq, and, ne, asc } from 'drizzle-orm';
import type { CreateUserInput, UpdateUserInput } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { permissionRowsForRole, permissionNamesForRole } from '../lib/role-permissions.js';
import { db } from '../lib/db.js';
import { users, userPermissions, sessions } from '../db/schema/index.js';

const BCRYPT_ROUNDS = 12;

/** Drizzle transaction/executor type (db and tx both satisfy this). */
type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Replace a user's stored permissions with the set granted by their role. This
 * is the single write path that keeps user_permissions in sync with role — used
 * on create and whenever a role changes. Without it, API-created users have zero
 * permissions and are 403'd on every guarded route.
 */
async function syncPermissionsForRole(tx: DbExecutor, userId: string, role: string): Promise<void> {
  await tx.delete(userPermissions).where(eq(userPermissions.userId, userId));
  const rows = permissionRowsForRole(role);
  if (rows.length > 0) {
    await tx.insert(userPermissions).values(
      rows.map((r) => ({ userId, resource: r.resource, action: r.action, scope: 'all' as const })),
    );
  }
}

/** Revoke every active session for a user (forces re-login). */
async function revokeSessions(tx: DbExecutor, userId: string): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
}

// ----- Response Types -----

export interface UserSummary {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly role: string;
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
          role: users.role,
          enabled: users.enabled,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(asc(users.username));

      return rows as readonly UserSummary[];
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
          role: users.role,
          enabled: users.enabled,
          lastLoginAt: users.lastLoginAt,
          failedLoginAttempts: users.failedLoginAttempts,
          lockedUntil: users.lockedUntil,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, id));

      if (!user) {
        throw new ServiceError('NOT_FOUND', `User not found: ${id}`);
      }

      return user as UserDetail;
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

      // Insert the user AND grant their role's permission set atomically, so a
      // created user can immediately use the routes their role allows.
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            username: input.username,
            email: input.email,
            passwordHash,
            ...(input.firstName != null ? { firstName: input.firstName } : {}),
            ...(input.lastName != null ? { lastName: input.lastName } : {}),
            role,
          })
          .returning({
            id: users.id,
            username: users.username,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            description: users.description,
            role: users.role,
            enabled: users.enabled,
            lastLoginAt: users.lastLoginAt,
            failedLoginAttempts: users.failedLoginAttempts,
            lockedUntil: users.lockedUntil,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
          });

        if (!row) {
          throw new ServiceError('INTERNAL', 'Failed to create user');
        }

        await syncPermissionsForRole(tx, row.id, role);
        return row;
      });

      emitEvent({
        level: 'INFO', name: 'USER_CREATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { createdUserId: (created as UserDetail).id, username: input.username },
      });

      return created as UserDetail;
    });
  }

  /** Update user fields. Admin-only. Cannot change own role. */
  static async updateUser(id: string, input: UpdateUserInput, actorId: string, context?: AuditContext): Promise<Result<UserDetail>> {
    return tryCatch(async () => {
      // Fetch existing
      const [existing] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, id));

      if (!existing) {
        throw new ServiceError('NOT_FOUND', `User not found: ${id}`);
      }

      // Cannot change own role
      if (id === actorId && input.role !== undefined && input.role !== existing.role) {
        throw new ServiceError('SELF_ACTION', 'Cannot change your own role');
      }

      // Build update object
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.email !== undefined) updates['email'] = input.email;
      if (input.firstName !== undefined) updates['firstName'] = input.firstName;
      if (input.lastName !== undefined) updates['lastName'] = input.lastName;
      if (input.role !== undefined) updates['role'] = input.role;
      if (input.enabled !== undefined) updates['enabled'] = input.enabled;

      const roleChanged = input.role !== undefined && input.role !== existing.role;
      const beingDisabled = input.enabled === false;

      await db.transaction(async (tx) => {
        await tx.update(users).set(updates).where(eq(users.id, id));

        // Re-sync permissions whenever the role changes so access matches the role.
        if (roleChanged && input.role !== undefined) {
          await syncPermissionsForRole(tx, id, input.role);
        }

        // Disabling a user must revoke their sessions — otherwise a disabled user
        // keeps a valid refresh token and can rotate indefinitely.
        if (beingDisabled) {
          await revokeSessions(tx, id);
        }
      });

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
          ...(roleChanged ? { oldRole: existing.role, newRole: input.role } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      });

      return result.value;
    });
  }

  /** Soft-delete: disable user. Cannot delete self or last admin. */
  static async deleteUser(id: string, actorId: string, context?: AuditContext): Promise<Result<void>> {
    return tryCatch(async () => {
      if (id === actorId) {
        throw new ServiceError('SELF_ACTION', 'Cannot delete your own account');
      }

      const [user] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, id));

      if (!user) {
        throw new ServiceError('NOT_FOUND', `User not found: ${id}`);
      }

      // Check if deleting last admin
      if (user.role === 'admin') {
        const adminRows = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.role, 'admin'));

        if (adminRows.length <= 1) {
          throw new ServiceError('CONFLICT', 'Cannot delete the last admin user');
        }
      }

      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ enabled: false, updatedAt: new Date() })
          .where(eq(users.id, id));
        await revokeSessions(tx, id);
      });

      emitEvent({
        level: 'INFO', name: 'USER_DELETED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { deletedUserId: id },
      });
    });
  }

  /** Change a user's password. Admin can change any, non-admin can only change own. */
  static async changePassword(id: string, newPassword: string, actorId: string, actorRole: string): Promise<Result<void>> {
    return tryCatch(async () => {
      // Non-admin can only change own password
      if (actorRole !== 'admin' && id !== actorId) {
        throw new ServiceError('FORBIDDEN', 'Cannot change another user\'s password');
      }

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id));

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

  /** Effective permission names for a user, resolved from their role. */
  static async getPermissions(id: string): Promise<Result<{ readonly role: string; readonly permissions: readonly string[] }>> {
    return tryCatch(async () => {
      const [user] = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, id));

      if (!user) {
        throw new ServiceError('NOT_FOUND', `User not found: ${id}`);
      }

      return { role: user.role, permissions: permissionNamesForRole(user.role) };
    });
  }

  /** Unlock a locked account. Resets failed attempts and lockout. */
  static async unlockUser(id: string): Promise<Result<void>> {
    return tryCatch(async () => {
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id));

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
