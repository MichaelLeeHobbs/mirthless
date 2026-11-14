// ===========================================
// Data Pruner Controller
// ===========================================
// HTTP adapter for data pruner operations.

import type { Request, Response } from 'express';
import { DataPrunerService } from '../services/data-pruner.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';

function auditContext(req: Request): { userId: string | null; ipAddress: string | null } {
  return {
    userId: req.user?.id ?? null,
    ipAddress: req.ip ?? null,
  };
}

export class DataPrunerController {
  /** POST /admin/prune — Prune all channels with pruning enabled. */
  static async pruneAll(req: Request, res: Response): Promise<void> {
    const result = await DataPrunerService.pruneAll(auditContext(req));

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to prune all channels');
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL', message: 'Internal server error' },
      });
      return;
    }

    logger.info(
      { channelsPruned: result.value.channelsPruned, totalDeleted: result.value.totalDeleted },
      'Data pruner completed',
    );
    res.json({ success: true, data: result.value });
  }

  /** POST /admin/prune/:channelId — Prune a specific channel. */
  static async pruneChannel(req: Request, res: Response): Promise<void> {
    const channelId = req.params['channelId'] as string;
    const maxAgeDays = (req.body as { maxAgeDays: number }).maxAgeDays;

    const result = await DataPrunerService.pruneChannel(
      channelId,
      maxAgeDays,
      auditContext(req),
    );

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({
        success: false,
        error: errorResponse(result.error),
      });
      return;
    }

    logger.info({ channelId, deletedCount: result.value.deletedCount }, 'Channel pruned');
    res.json({ success: true, data: result.value });
  }

  /** GET /admin/prune/statistics — Get prunable message counts per channel. */
  static async getStatistics(_req: Request, res: Response): Promise<void> {
    const result = await DataPrunerService.getStatistics();

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to get pruner statistics');
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL', message: 'Internal server error' },
      });
      return;
    }

    res.json({ success: true, data: result.value });
  }
}
