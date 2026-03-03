// ===========================================
// User Preference Controller
// ===========================================
// Handles HTTP requests for per-user preference CRUD.

import type { Request, Response } from 'express';
import type { UpsertPreferenceInput, BulkUpsertPreferencesInput } from '@mirthless/core-models';
import { UserPreferenceService } from '../services/user-preference.service.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  return 500;
}

function errorResponse(error: unknown): { code: string; message: string } {
  if (isServiceError(error)) return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: 'Internal server error' };
}

export class UserPreferenceController {
  static async list(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id ?? '';
    const result = await UserPreferenceService.list(userId);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to list user preferences');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getByKey(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id ?? '';
    const key = req.params['key'] as string;
    const result = await UserPreferenceService.getByKey(userId, key);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, key }, 'Failed to get user preference');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async upsert(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id ?? '';
    const input = req.body as UpsertPreferenceInput;
    const result = await UserPreferenceService.upsert(userId, input.key, input.value);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to upsert user preference');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async bulkUpsert(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id ?? '';
    const input = req.body as BulkUpsertPreferencesInput;
    const result = await UserPreferenceService.bulkUpsert(userId, input.entries);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to bulk upsert user preferences');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id ?? '';
    const key = req.params['key'] as string;
    const result = await UserPreferenceService.delete(userId, key);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, key }, 'Failed to delete user preference');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.status(204).send();
  }
}
