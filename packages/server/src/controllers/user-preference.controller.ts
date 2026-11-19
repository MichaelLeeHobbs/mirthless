import type { Request, Response } from 'express';
import type { UpsertPreferenceInput, BulkUpsertPreferencesInput } from '@galvanigraph/core-models';
import { UserPreferenceService } from '../services/user-preference.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';

/**
 * Null after answering. A missing user must fail rather than read user ''. The
 * routes sit behind `authenticate`, so it is a server bug: 500, not 401, which
 * the web client reads as an expired session (D-263) and signs the user out.
 */
function requireUserId(req: Request, res: Response): string | null {
  const userId = req.user?.id;
  if (userId) return userId;
  logger.error({ path: req.path }, 'User preference request reached the controller without an authenticated user');
  res.status(500).json({ success: false, error: errorResponse(null) });
  return null;
}

export class UserPreferenceController {
  static async list(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req, res);
    if (userId === null) return;
    const result = await UserPreferenceService.list(userId);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list user preferences');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getByKey(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req, res);
    if (userId === null) return;
    const key = req.params['key'] as string;
    const result = await UserPreferenceService.getByKey(userId, key);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, key }, 'Failed to get user preference');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async upsert(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req, res);
    if (userId === null) return;
    const input = req.body as UpsertPreferenceInput;
    const result = await UserPreferenceService.upsert(userId, input.key, input.value);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to upsert user preference');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async bulkUpsert(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req, res);
    if (userId === null) return;
    const input = req.body as BulkUpsertPreferencesInput;
    const result = await UserPreferenceService.bulkUpsert(userId, input.entries);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to bulk upsert user preferences');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req, res);
    if (userId === null) return;
    const key = req.params['key'] as string;
    const result = await UserPreferenceService.delete(userId, key);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, key }, 'Failed to delete user preference');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.status(204).send();
  }
}
