// ===========================================
// User Service
// ===========================================
// CRUD operations for user management.
// All methods return Result<T> using tryCatch from stderr-lib.

import bcrypt from 'bcryptjs';
import { tryCatch, type Result } from 'stderr-lib';
import { eq, asc } from 'drizzle-orm';
import type { CreateUserInput, UpdateUserInput } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { users } from '../db/schema/index.js';

const BCRYPT_ROUNDS = 12;

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
  static async createUser(input: CreateUserInput): Promise<Result<UserDetail>> {
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

      const [created] = await db
        .insert(users)
        .values({
          username: input.username,
          email: input.email,
          passwordHash,
          ...(input.firstName != null ? { firstName: input.firstName } : {}),
          ...(input.lastName != null ? { lastName: input.lastName } : {}),
          role: input.role ?? 'viewer',
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

      return created as UserDetail;
    });
  }

  /** Update user fields. Admin-only. Cannot change own role. */
  static async updateUser(id: string, input: UpdateUserInput, actorId: string): Promise<Result<UserDetail>> {
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

      await db
        .update(users)
        .set(updates)
        .where(eq(users.id, id));

      // Fetch and return updated user
      const result = await this.getUser(id);
      if (!result.ok) throw result.error;
      return result.value;
    });
  }

  /** Soft-delete: disable user. Cannot delete self or last admin. */
  static async deleteUser(id: string, actorId: string): Promise<Result<void>> {
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

      await db
        .update(users)
        .set({ enabled: false, updatedAt: new Date() })
        .where(eq(users.id, id));
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

      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, id));
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
