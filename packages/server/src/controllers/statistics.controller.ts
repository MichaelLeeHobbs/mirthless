import type { Request, Response } from 'express';
import { StatisticsService } from '../services/statistics.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';
import { channelScopeOf } from '../lib/channel-scope.js';

export class StatisticsController {
  static async getChannelStats(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const result = await StatisticsService.getChannelStatistics(channelId);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getAllStats(req: Request, res: Response): Promise<void> {
    const result = await StatisticsService.getAllChannelStatistics(await channelScopeOf(req, 'channels:read'));

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to get all channel statistics');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async resetStats(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const result = await StatisticsService.resetStatistics(channelId);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId }, 'Statistics reset');
    res.status(204).send();
  }
}
