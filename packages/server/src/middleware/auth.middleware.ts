// ===========================================
// Auth Middleware
// ===========================================
// Verifies JWT tokens and attaches user info to request.

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt.js';
import { db } from '../lib/db.js';
import { users, userPermissions } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import logger from '../lib/logger.js';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: {
        id: string;
        username: string;
        email: string;
        role: string;
        isActive: boolean;
        permissions: readonly string[];
      };
      sessionId?: string;
    }
  }
}

/**
 * Build permissions array from user_permissions table rows.
 */
async function loadUserPermissions(userId: string): Promise<readonly string[]> {
  const rows = await db
    .select({
      resource: userPermissions.resource,
      action: userPermissions.action,
    })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId));

  return rows.map((r) => `${r.resource}:${r.action}`);
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyAccessToken(token);

    // Fetch user from database to get current status
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        enabled: users.enabled,
      })
      .from(users)
      .where(eq(users.id, payload.userId));

    if (!user) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }

    if (!user.enabled) {
      res.status(403).json({ success: false, error: 'Account is deactivated' });
      return;
    }

    // Load permissions from user_permissions table
    const permissions = await loadUserPermissions(user.id);

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.enabled,
      permissions,
    };
    if (payload.sessionId) {
      req.sessionId = payload.sessionId;
    }
    next();
  } catch (error) {
    logger.debug({ errMsg: error instanceof Error ? error.message : String(error) }, 'Token verification failed');
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

/**
 * Optional auth — attaches user if token present but doesn't fail if absent.
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyAccessToken(token);

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        enabled: users.enabled,
      })
      .from(users)
      .where(eq(users.id, payload.userId));

    if (user && user.enabled) {
      const permissions = await loadUserPermissions(user.id);

      req.user = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        isActive: user.enabled,
        permissions,
      };
      if (payload.sessionId) {
        req.sessionId = payload.sessionId;
      }
    }
  } catch {
    // Ignore invalid tokens for optional auth
  }

  next();
}
