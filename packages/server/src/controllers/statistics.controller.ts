// ===========================================
// Statistics Controller
// ===========================================
// HTTP adapter for channel statistics queries.

import type { Request, Response } from 'express';
import { StatisticsService } from '../services/statistics.service.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
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

export class StatisticsController {
  /** GET /channels/:id/statistics — Per-channel statistics with connector breakdown. */
  static async getChannelStats(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const result = await StatisticsService.getChannelStatistics(channelId);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: { code: errorCode(result.error), message: errorMessage(result.error) } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  /** GET /channels/statistics — All channels summary for dashboard. */
  static async getAllStats(_req: Request, res: Response): Promise<void> {
    const result = await StatisticsService.getAllChannelStatistics();

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to get all channel statistics');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  /** POST /channels/:id/statistics/reset — Reset current-window counters. */
  static async resetStats(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const result = await StatisticsService.resetStatistics(channelId);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: { code: errorCode(result.error), message: errorMessage(result.error) } });
      return;
    }

    logger.info({ channelId }, 'Statistics reset');
    res.status(204).send();
  }
}
