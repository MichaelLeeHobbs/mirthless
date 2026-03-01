// ===========================================
// Auth Service
// ===========================================
// Handles user login, token refresh, and logout.
// All methods return Result<T> using tryCatch from stderr-lib.

import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { tryCatch, type Result } from 'stderr-lib';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { users, sessions, userPermissions } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js';
import { emitEvent } from '../lib/event-emitter.js';

const REFRESH_TOKEN_DAYS = 7;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionMetadata {
  userAgent?: string;
  ipAddress?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserResponse {
  id: string;
  username: string;
  email: string;
  role: string;
  permissions: readonly string[];
}

export interface LoginResult {
  user: UserResponse;
  accessToken: string;
  refreshToken: string;
}

async function loadPermissions(userId: string): Promise<readonly string[]> {
  const rows = await db
    .select({ resource: userPermissions.resource, action: userPermissions.action })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId));

  return rows.map((r) => `${r.resource}:${r.action}`);
}

export class AuthService {
  static async login(
    username: string,
    password: string,
    metadata?: SessionMetadata
  ): Promise<Result<LoginResult>> {
    return tryCatch(async () => {
      // Find user by username
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username));

      if (!user) {
        throw new ServiceError('INVALID_CREDENTIALS', 'Invalid credentials');
      }

      // Check account lockout
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        const minutesRemaining = Math.ceil(
          (user.lockedUntil.getTime() - Date.now()) / 60_000
        );
        throw new ServiceError('ACCOUNT_LOCKED', 'Account is locked', { minutesRemaining });
      }

      // Check if account is enabled
      if (!user.enabled) {
        throw new ServiceError('ACCOUNT_DEACTIVATED', 'Account is deactivated');
      }

      // Verify password
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        // Record failed attempt
        const newAttempts = user.failedLoginAttempts + 1;
        const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS;

        await db
          .update(users)
          .set({
            failedLoginAttempts: newAttempts,
            ...(shouldLock ? { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) } : {}),
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));

        if (shouldLock) {
          throw new ServiceError(
            'ACCOUNT_LOCKED',
            'Too many failed attempts. Account has been temporarily locked.',
            { lockedNow: true }
          );
        }

        emitEvent({
          level: 'WARN', name: 'USER_LOGIN_FAILED', outcome: 'FAILURE',
          userId: user.id, channelId: null, serverId: null,
          ipAddress: metadata?.ipAddress ?? null,
          attributes: { username, reason: 'invalid_password' },
        });

        throw new ServiceError('INVALID_CREDENTIALS', 'Invalid credentials');
      }

      // Reset failed attempts and update last login
      await db
        .update(users)
        .set({
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      // Create session and tokens
      const tokens = await this.createTokens(user.id, metadata);

      // Load permissions
      const permissions = await loadPermissions(user.id);

      emitEvent({
        level: 'INFO', name: 'USER_LOGIN', outcome: 'SUCCESS',
        userId: user.id, channelId: null, serverId: null,
        ipAddress: metadata?.ipAddress ?? null,
        attributes: { username: user.username },
      });

      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          permissions,
        },
        ...tokens,
      };
    });
  }

  static async refreshSession(refreshToken: string): Promise<Result<AuthTokens>> {
    return tryCatch(async () => {
      // Verify token signature
      const payload = verifyRefreshToken(refreshToken);

      // Find session in database by hashed token
      const hashedToken = hashToken(refreshToken);
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.refreshToken, hashedToken));

      if (!session || session.expiresAt < new Date()) {
        throw new Error('Invalid refresh token');
      }

      // Delete old session (rotate tokens)
      await db.delete(sessions).where(eq(sessions.id, session.id));

      // Create new tokens
      return await this.createTokens(payload.userId);
    });
  }

  static async logout(sessionId: string): Promise<Result<void>> {
    return tryCatch(async () => {
      await db.delete(sessions).where(eq(sessions.id, sessionId));
    });
  }

  private static async createTokens(
    userId: string,
    metadata?: SessionMetadata
  ): Promise<AuthTokens> {
    const refreshToken = signRefreshToken({ userId });

    // Store hashed refresh token in database with metadata
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_DAYS);

    const [session] = await db
      .insert(sessions)
      .values({
        userId,
        refreshToken: hashToken(refreshToken),
        userAgent: metadata?.userAgent,
        ipAddress: metadata?.ipAddress,
        lastUsedAt: new Date(),
        expiresAt,
      })
      .returning({ id: sessions.id });

    const accessToken = signAccessToken({ userId, sessionId: session!.id });

    return { accessToken, refreshToken };
  }
}
