// ===========================================
// Permission Middleware
// ===========================================
// Middleware for checking user permissions on routes.
// Checks directly against req.user.permissions array.

import type { NextFunction, Request, Response } from 'express';
import logger from '../lib/logger.js';

/**
 * Require user to have at least one of the specified permissions.
 */
export function requirePermission(...permissions: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const hasPermission = permissions.some((p) => req.user!.permissions.includes(p));

    if (!hasPermission) {
      logger.debug(
        {
          userId: req.user.id,
          required: permissions,
          path: req.path,
        },
        'Permission denied'
      );
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    next();
  };
}

/**
 * Require user to have all of the specified permissions.
 */
export function requireAllPermissions(...permissions: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const hasAllPermissions = permissions.every((p) => req.user!.permissions.includes(p));

    if (!hasAllPermissions) {
      logger.debug(
        {
          userId: req.user.id,
          required: permissions,
          path: req.path,
        },
        'Permission denied (all required)'
      );
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    next();
  };
}
