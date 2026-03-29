// ===========================================
// Pruner Scheduler Controller
// ===========================================
// Handles HTTP requests for pruner scheduling.

import type { Request, Response } from 'express';
import type { UpdatePrunerScheduleInput } from '../services/pruner-scheduler.service.js';
import { isServiceError } from '../lib/service-error.js';
import { PrunerSchedulerService } from '../services/pruner-scheduler.service.js';
import logger from '../lib/logger.js';

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  if (isServiceError(error, 'ALREADY_EXISTS')) return 409;
  return 500;
}

function errorResponse(error: unknown): { code: string; message: string } {
  if (isServiceError(error)) return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: 'Internal server error' };
}

export class PrunerSchedulerController {
  static async getStatus(_req: Request, res: Response): Promise<void> {
    const result = await PrunerSchedulerService.getStatus();

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to get pruner status');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async updateSchedule(req: Request, res: Response): Promise<void> {
    const input = req.body as UpdatePrunerScheduleInput;
    const result = await PrunerSchedulerService.updateSchedule(input);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to update pruner schedule');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ enabled: input.enabled, cron: input.cronExpression }, 'Pruner schedule updated');
    res.json({ success: true, data: result.value });
  }
}
