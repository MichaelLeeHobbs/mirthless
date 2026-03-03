// ===========================================
// Global Map Controller
// ===========================================
// Handles HTTP requests for global map key-value store CRUD.

import type { Request, Response } from 'express';
import type { UpsertGlobalMapEntryInput } from '@mirthless/core-models';
import { GlobalMapService } from '../services/global-map.service.js';
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

export class GlobalMapController {
  static async list(_req: Request, res: Response): Promise<void> {
    const result = await GlobalMapService.list();

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to list global map entries');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getByKey(req: Request, res: Response): Promise<void> {
    const key = req.params['key'] as string;
    const result = await GlobalMapService.getByKey(key);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, key }, 'Failed to get global map entry');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async upsert(req: Request, res: Response): Promise<void> {
    const key = req.params['key'] as string;
    const input = req.body as UpsertGlobalMapEntryInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await GlobalMapService.upsert(key, input.value, context);

    if (!result.ok) {
      logger.error({ error: result.error, key }, 'Failed to upsert global map entry');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    logger.info({ key }, 'Global map entry upserted');
    res.json({ success: true, data: result.value });
  }

  static async clear(req: Request, res: Response): Promise<void> {
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await GlobalMapService.clear(context);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to clear global map');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    logger.info('Global map cleared');
    res.status(204).send();
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const key = req.params['key'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await GlobalMapService.delete(key, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, key }, 'Failed to delete global map entry');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ key }, 'Global map entry deleted');
    res.status(204).send();
  }
}
