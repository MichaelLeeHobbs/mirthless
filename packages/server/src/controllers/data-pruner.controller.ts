import type { Request, Response } from 'express';
import { DataPrunerService } from '../services/data-pruner.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';
import { channelScopeOf } from '../lib/channel-scope.js';

function auditContext(req: Request): { userId: string | null; ipAddress: string | null } {
  return {
    userId: req.user?.id ?? null,
    ipAddress: req.ip ?? null,
  };
}

export class DataPrunerController {
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

  static async getStatistics(req: Request, res: Response): Promise<void> {
    const result = await DataPrunerService.getStatistics(await channelScopeOf(req, 'settings:read'));

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
