// ===========================================
// User Controller
// ===========================================
// Handles HTTP requests for user management.

import type { Request, Response } from 'express';
import type { CreateUserInput, UpdateUserInput, ChangePasswordInput } from '@mirthless/core-models';
import { UserService } from '../services/user.service.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  if (isServiceError(error, 'ALREADY_EXISTS')) return 409;
  if (isServiceError(error, 'CONFLICT')) return 409;
  if (isServiceError(error, 'SELF_ACTION')) return 400;
  if (isServiceError(error, 'FORBIDDEN')) return 403;
  return 500;
}

function errorCode(error: unknown): string {
  if (isServiceError(error)) return error.code;
  return 'INTERNAL';
}

function errorMessage(error: unknown): string {
  if (isServiceError(error)) return error.message;
  return 'Internal server error';
}

export class UserController {
  static async list(_req: Request, res: Response): Promise<void> {
    const result = await UserService.listUsers();

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to list users');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await UserService.getUser(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: { code: errorCode(result.error), message: errorMessage(result.error) } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateUserInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await UserService.createUser(input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, username: input.username }, 'Failed to create user');
      res.status(status).json({ success: false, error: { code: errorCode(result.error), message: errorMessage(result.error) } });
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
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, userId: id }, 'Failed to update user');
      res.status(status).json({ success: false, error: { code: errorCode(result.error), message: errorMessage(result.error) } });
      return;
    }

    logger.info({ userId: id }, 'User updated');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const actorId = req.user!.id;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await UserService.deleteUser(id, actorId, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, userId: id }, 'Failed to delete user');
      res.status(status).json({ success: false, error: { code: errorCode(result.error), message: errorMessage(result.error) } });
      return;
    }

    logger.info({ userId: id }, 'User deleted');
    res.status(204).send();
  }

  static async changePassword(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const { newPassword } = req.body as ChangePasswordInput;
    const actorId = req.user!.id;
    const actorRole = req.user!.role;
    const result = await UserService.changePassword(id, newPassword, actorId, actorRole);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: { code: errorCode(result.error), message: errorMessage(result.error) } });
      return;
    }

    logger.info({ userId: id }, 'Password changed');
    res.status(204).send();
  }

  static async unlock(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await UserService.unlockUser(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: { code: errorCode(result.error), message: errorMessage(result.error) } });
      return;
    }

    logger.info({ userId: id }, 'User unlocked');
    res.status(204).send();
  }
}
