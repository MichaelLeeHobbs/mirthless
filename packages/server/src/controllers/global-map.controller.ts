// ===========================================
// Global Map Controller
// ===========================================
// Handles HTTP requests for global map key-value store CRUD.

import type { Request, Response } from 'express';
import { AUDIT_ACTION, type UpsertGlobalMapEntryInput } from '@galvanigraph/core-models';
import { GlobalMapService } from '../services/global-map.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { recordReadBestEffort } from '../lib/audited-read.js';
import logger from '../lib/logger.js';

export class GlobalMapController {
  static async list(req: Request, res: Response): Promise<void> {
    const result = await GlobalMapService.list();

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list global map entries');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    // Scripts keep PHI and credentials here: recorded, best effort (D-312).
    recordReadBestEffort(req, {
      action: AUDIT_ACTION.GLOBAL_MAP_READ, attributes: { entries: result.value.length },
      // Keys are often built from patient identifiers: they dedupe, but stay out of the record.
      dedupe: { key: 'global-map', ids: result.value.map((e) => e.key), idsOnlyForDedupe: true },
    });
    res.json({ success: true, data: result.value });
  }

  static async getByKey(req: Request, res: Response): Promise<void> {
    const key = req.params['key'] as string;
    const result = await GlobalMapService.getByKey(key);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, key }, 'Failed to get global map entry');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    recordReadBestEffort(req, {
      action: AUDIT_ACTION.GLOBAL_MAP_READ, attributes: { entries: 1 },
      dedupe: { key: `global-map|${key}`, ids: [key], idsOnlyForDedupe: true },
    });
    res.json({ success: true, data: result.value });
  }

  static async upsert(req: Request, res: Response): Promise<void> {
    const key = req.params['key'] as string;
    const input = req.body as UpsertGlobalMapEntryInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await GlobalMapService.upsert(key, input.value, context);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack, key }, 'Failed to upsert global map entry');
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
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to clear global map');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    logger.info({ operation: 'clear' }, 'Global map cleared');
    res.status(204).send();
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const key = req.params['key'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await GlobalMapService.delete(key, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, key }, 'Failed to delete global map entry');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ key }, 'Global map entry deleted');
    res.status(204).send();
  }
}
