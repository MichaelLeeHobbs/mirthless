// ===========================================
// Settings Controller
// ===========================================
// Handles HTTP requests for system settings CRUD operations.

import type { Request, Response } from 'express';
import type {
  SettingsListQuery,
  SettingKeyParam,
  UpsertSettingInput,
  BulkUpsertSettingsInput,
} from '@mirthless/core-models';
import { SettingsService } from '../services/settings.service.js';
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

export class SettingsController {
  static async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as SettingsListQuery;
    const result = await SettingsService.list(
      query.category !== undefined ? { category: query.category } : undefined,
    );

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to list settings');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getByKey(req: Request, res: Response): Promise<void> {
    const { key } = req.params as unknown as SettingKeyParam;
    const result = await SettingsService.getByKey(key);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, key }, 'Failed to get setting');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async upsert(req: Request, res: Response): Promise<void> {
    const { key } = req.params as unknown as SettingKeyParam;
    const body = req.body as UpsertSettingInput;
    const input: UpsertSettingInput = { ...body, key };

    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await SettingsService.upsert(input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, key }, 'Failed to upsert setting');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ key }, 'Setting upserted');
    res.json({ success: true, data: result.value });
  }

  static async bulkUpsert(req: Request, res: Response): Promise<void> {
    const { settings } = req.body as BulkUpsertSettingsInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await SettingsService.bulkUpsert(settings, context);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to bulk upsert settings');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    logger.info({ count: settings.length }, 'Settings bulk upserted');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const { key } = req.params as unknown as SettingKeyParam;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await SettingsService.delete(key, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, key }, 'Failed to delete setting');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ key }, 'Setting deleted');
    res.status(204).send();
  }
}
