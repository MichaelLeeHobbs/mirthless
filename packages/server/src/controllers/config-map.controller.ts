// ===========================================
// Configuration Map Controller
// ===========================================
// Handles HTTP requests for categorized configuration map CRUD.

import type { Request, Response } from 'express';
import type { UpsertConfigMapEntryInput, BulkUpsertConfigMapInput, ConfigMapQuery } from '@mirthless/core-models';
import { ConfigMapService } from '../services/config-map.service.js';
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

export class ConfigMapController {
  static async list(req: Request, res: Response): Promise<void> {
    const raw = req.query as ConfigMapQuery;
    const query = raw.category !== undefined ? { category: raw.category } : undefined;
    const result = await ConfigMapService.list(query);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to list config map entries');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getByKey(req: Request, res: Response): Promise<void> {
    const category = req.params['category'] as string;
    const name = req.params['name'] as string;
    const result = await ConfigMapService.getByKey(category, name);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, category, name }, 'Failed to get config map entry');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async upsert(req: Request, res: Response): Promise<void> {
    const category = req.params['category'] as string;
    const name = req.params['name'] as string;
    const input = req.body as UpsertConfigMapEntryInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ConfigMapService.upsert(category, name, input.value, context);

    if (!result.ok) {
      logger.error({ error: result.error, category, name }, 'Failed to upsert config map entry');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    logger.info({ category, name }, 'Config map entry upserted');
    res.json({ success: true, data: result.value });
  }

  static async bulkUpsert(req: Request, res: Response): Promise<void> {
    const input = req.body as BulkUpsertConfigMapInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ConfigMapService.bulkUpsert(input.entries, context);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to bulk upsert config map entries');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    logger.info({ count: input.entries.length }, 'Config map bulk upserted');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const category = req.params['category'] as string;
    const name = req.params['name'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ConfigMapService.delete(category, name, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, category, name }, 'Failed to delete config map entry');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ category, name }, 'Config map entry deleted');
    res.status(204).send();
  }
}
