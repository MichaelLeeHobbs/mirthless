// ===========================================
// User Controller
// ===========================================
// Handles HTTP requests for user management.

import type { Request, Response } from 'express';
import { holdsPermission, type SetAssignmentsInput, type CreateUserInput, type UpdateUserInput, type ChangePasswordInput, type ChangeOwnPasswordInput, type DeleteUserQuery } from '@galvanigraph/core-models';
import { UserService } from '../services/user.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

/**
 * The shared map, except a wrong current password is 400, not 401: the web
 * client reads any 401 as an expired session and refreshes the token.
 */
function userErrorStatus(error: unknown): number {
  if (isServiceError(error, 'INVALID_CREDENTIALS')) return 400;
  return mapErrorToStatus(error);
}

/**
 * Taking over a leaver's API keys is a key change, so it needs api_keys:manage
 * as well as the right to delete the user (D-322); the key service also checks
 * the caller covers each key. Answers 403 and returns false when it lacks it.
 */
function mayTakeOwnership(req: Request, res: Response, keyIds: readonly string[]): boolean {
  if (keyIds.length === 0 || holdsPermission(req.user?.permissions, 'api_keys:manage')) return true;
  res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Taking over a leaver\'s API keys needs api_keys:manage' } });
  return false;
}

export class UserController {
  static async list(_req: Request, res: Response): Promise<void> {
    const result = await UserService.listUsers();

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list users');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await UserService.getUser(id);

    if (!result.ok) {
      const status = userErrorStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateUserInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await UserService.createUser(input, context);

    if (!result.ok) {
      const status = userErrorStatus(result.error);
      logger.warn({ errMsg: result.error.message, username: input.username }, 'Failed to create user');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ userId: result.value.id }, 'User created');
    res.status(201).json({ success: true, data: result.value });
  }

  static async update(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as UpdateUserInput;
    const actorId = req.user!.id;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await UserService.updateUser(id, input, actorId, context);

    if (!result.ok) {
      const status = userErrorStatus(result.error);
      logger.warn({ errMsg: result.error.message, userId: id }, 'Failed to update user');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ userId: id }, 'User updated');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const actorId = req.user!.id;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const { takeOwnership } = req.query as unknown as DeleteUserQuery;
    if (!mayTakeOwnership(req, res, takeOwnership)) return;
    const result = await UserService.deleteUser(id, actorId, context, takeOwnership);

    if (!result.ok) {
      const status = userErrorStatus(result.error);
      logger.warn({ errMsg: result.error.message, userId: id }, 'Failed to delete user');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ userId: id }, 'User deleted');
    if (result.value.length === 0) {
      res.status(204).send();
      return;
    }
    // The new tokens of the keys taken over, shown this once: never cached.
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, data: { takenOver: result.value } });
  }

  static async changePassword(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const { newPassword } = req.body as ChangePasswordInput;
    const actorId = req.user!.id;
    const result = await UserService.changePassword(id, newPassword, actorId, holdsPermission(req.user?.permissions, 'users:write'));

    if (!result.ok) {
      const status = userErrorStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ userId: id }, 'Password changed');
    res.status(204).send();
  }

  /** POST /users/me/password — self-service password change (no users:write). */
  static async changeOwnPassword(req: Request, res: Response): Promise<void> {
    const { currentPassword, newPassword } = req.body as ChangeOwnPasswordInput;
    const userId = req.user!.id;
    const result = await UserService.changeOwnPassword(userId, currentPassword, newPassword, req.sessionId);

    if (!result.ok) {
      const status = userErrorStatus(result.error);
      logger.warn({ errMsg: result.error.message, userId }, 'Self password change failed');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ userId }, 'Self password changed');
    res.status(204).send();
  }

  /** GET /users/:id/permissions — view a user's effective role→permissions. */
  static async getPermissions(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await UserService.getPermissions(id);

    if (!result.ok) {
      const status = userErrorStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getAssignments(req: Request, res: Response): Promise<void> {
    const result = await UserService.getAssignments(req.params['id'] as string);
    if (!result.ok) {
      res.status(userErrorStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    res.json({ success: true, data: result.value });
  }

  static async setAssignments(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as SetAssignmentsInput;
    const result = await UserService.setAssignments(id, input.assignments, { userId: req.user!.id, ipAddress: req.ip ?? null });
    if (!result.ok) {
      const status = userErrorStatus(result.error);
      logger.warn({ errMsg: result.error.message, userId: id }, 'Failed to set assignments');
      // The details name what is missing; they hold permission names and assignment ids only.
      const details = isServiceError(result.error) ? result.error.details : undefined;
      res.status(status).json({ success: false, error: { ...errorResponse(result.error), ...(details === undefined ? {} : { details }) } });
      return;
    }
    logger.info({ userId: id }, 'Assignments set');
    res.json({ success: true, data: result.value });
  }

  static async unlock(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await UserService.unlockUser(id, req.user!.id);

    if (!result.ok) {
      const status = userErrorStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ userId: id }, 'User unlocked');
    res.status(204).send();
  }
}
