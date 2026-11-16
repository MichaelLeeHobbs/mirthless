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
import { users, sessions } from '../db/schema/index.js';
import { permissionNamesForRole } from '../lib/role-permissions.js';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { signAccessToken, signRefreshToken, tokenExpiresAt, verifyRefreshToken } from '../lib/jwt.js';
import { emitEvent } from '../lib/event-emitter.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
/**
 * A bcrypt hash (cost 12, like real ones) of a random value nobody knows. A
 * login for a username that does not exist is compared against it so that it
 * takes as long as a login for one that does.
 */
const UNKNOWN_USER_HASH = '$2b$12$HhlOWRMeDl0myMDRClZP7e/jD1W8DQWGrtRSTDJK5m6T22C3vyJLG';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Audit-log a rejected login. Every rejection is recorded, including unknown usernames. */
function auditLoginFailure(
  username: string,
  userId: string | null,
  reason: string,
  metadata: SessionMetadata | undefined,
): void {
  emitEvent({
    level: 'WARN', name: 'USER_LOGIN_FAILED', outcome: 'FAILURE',
    userId, channelId: null, serverId: null,
    ipAddress: metadata?.ipAddress ?? null,
    attributes: { username, reason },
  });
}

/** What counting a wrong password did to the account. */
type FailedAttemptOutcome = 'counted' | 'locked_now' | 'already_locked';

/**
 * Count a wrong password in one UPDATE, so concurrent wrong guesses each count
 * and a late write cannot clear a lock another request set (#174). The row is
 * updated only while it is not locked at `now`. A lock that has expired no
 * longer counts: the count starts again at one and the old lock is cleared.
 * Reaching MAX_FAILED_ATTEMPTS sets a new lock. No row updated means a
 * concurrent request locked the account first.
 */
async function recordFailedAttempt(userId: string, now: Date): Promise<FailedAttemptOutcome> {
  const lockExpired = sql`(${users.lockedUntil} IS NOT NULL AND ${users.lockedUntil} <= ${now}::timestamptz)`;
  const attempts = sql`(CASE WHEN ${lockExpired} THEN 1 ELSE ${users.failedLoginAttempts} + 1 END)`;
  const lockUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
  const [row] = await db
    .update(users)
    .set({
      failedLoginAttempts: attempts,
      lockedUntil: sql`CASE WHEN ${attempts} >= ${MAX_FAILED_ATTEMPTS} THEN ${lockUntil}::timestamptz WHEN ${lockExpired} THEN NULL ELSE ${users.lockedUntil} END`,
      updatedAt: now,
    })
    .where(and(eq(users.id, userId), or(isNull(users.lockedUntil), lte(users.lockedUntil, now))))
    .returning({ failedLoginAttempts: users.failedLoginAttempts });
  if (!row) return 'already_locked';
  return row.failedLoginAttempts >= MAX_FAILED_ATTEMPTS ? 'locked_now' : 'counted';
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
  /** True when the user must change their password before proceeding. */
  mustChangePassword: boolean;
}

/** What a login or a refresh returns: the user as they are now, and the new tokens. */
export interface LoginResult {
  user: UserResponse;
  accessToken: string;
  refreshToken: string;
}

/**
 * The user as the web sees them. Permissions are resolved live from the role
 * (single source of truth), so each login and refresh carries the current list.
 */
function toUserResponse(user: {
  readonly id: string; readonly username: string; readonly email: string;
  readonly role: string; readonly mustChangePassword: boolean;
}): UserResponse {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    permissions: permissionNamesForRole(user.role),
    mustChangePassword: user.mustChangePassword,
  };
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
        // Spend the same time as a real password check, so the response time
        // does not tell a caller which usernames exist.
        await bcrypt.compare(password, UNKNOWN_USER_HASH);
        auditLoginFailure(username, null, 'unknown_user', metadata);
        throw new ServiceError('INVALID_CREDENTIALS', 'Invalid credentials');
      }

      // Check account lockout
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        auditLoginFailure(username, user.id, 'account_locked', metadata);
        const minutesRemaining = Math.ceil(
          (user.lockedUntil.getTime() - Date.now()) / 60_000
        );
        throw new ServiceError('ACCOUNT_LOCKED', 'Account is locked', { minutesRemaining });
      }

      // Check if account is enabled
      if (!user.enabled) {
        auditLoginFailure(username, user.id, 'account_disabled', metadata);
        throw new ServiceError('ACCOUNT_DEACTIVATED', 'Account is deactivated');
      }

      // Verify password
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        const outcome = await recordFailedAttempt(user.id, new Date());
        if (outcome === 'counted') {
          auditLoginFailure(username, user.id, 'invalid_password', metadata);
          throw new ServiceError('INVALID_CREDENTIALS', 'Invalid credentials');
        }
        // This attempt locked the account, or a concurrent one did first.
        auditLoginFailure(username, user.id, outcome === 'locked_now' ? 'invalid_password_locked' : 'account_locked', metadata);
        throw new ServiceError(
          'ACCOUNT_LOCKED',
          'Too many failed attempts. Account has been temporarily locked.',
          { lockedNow: true }
        );
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

      emitEvent({
        level: 'INFO', name: 'USER_LOGIN', outcome: 'SUCCESS',
        userId: user.id, channelId: null, serverId: null,
        ipAddress: metadata?.ipAddress ?? null,
        attributes: { username: user.username },
      });

      return { user: toUserResponse(user), ...tokens };
    });
  }

  /**
   * Rotate a session: check the refresh token, drop its session and open a new
   * one that records the client details of the request doing the rotation.
   * Returns the user as they are now, so the web picks up a role change (#219).
   */
  static async refreshSession(refreshToken: string, metadata?: SessionMetadata): Promise<Result<LoginResult>> {
    return tryCatch(async () => {
      // Verify token signature (throws on tamper/expiry). We rely on the DB
      // session + a fresh user check below rather than the token's own claims.
      verifyRefreshToken(refreshToken);

      // Consume the session in one statement: of two concurrent refreshes with
      // the same token, only one gets the row back, so a token works once (#174).
      const [session] = await db
        .delete(sessions)
        .where(eq(sessions.refreshToken, hashToken(refreshToken)))
        .returning({ userId: sessions.userId, expiresAt: sessions.expiresAt });

      if (!session || session.expiresAt < new Date()) {
        throw new Error('Invalid refresh token');
      }

      // Re-validate the user on every refresh: a disabled or deleted user must not
      // be able to keep rotating tokens. Their session is already gone.
      const [user] = await db
        .select({
          id: users.id, username: users.username, email: users.email, role: users.role,
          enabled: users.enabled, mustChangePassword: users.mustChangePassword,
        })
        .from(users)
        .where(eq(users.id, session.userId));

      if (!user || !user.enabled) {
        throw new Error('Invalid refresh token');
      }

      const tokens = await this.createTokens(session.userId, metadata);
      return { user: toUserResponse(user), ...tokens };
    });
  }

  static async logout(sessionId: string, userId: string | null, ipAddress: string | null): Promise<Result<void>> {
    return tryCatch(async () => {
      await db.delete(sessions).where(eq(sessions.id, sessionId));
      emitEvent({
        level: 'INFO', name: 'USER_LOGOUT', outcome: 'SUCCESS',
        userId, channelId: null, serverId: null, ipAddress, attributes: {},
      });
    });
  }

  private static async createTokens(
    userId: string,
    metadata?: SessionMetadata
  ): Promise<AuthTokens> {
    const refreshToken = signRefreshToken({ userId });

    // Store hashed refresh token in database with metadata. The session ends
    // when the token does, so JWT_REFRESH_EXPIRES_IN sets both.
    const expiresAt = tokenExpiresAt(refreshToken);

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
