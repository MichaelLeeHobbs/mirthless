// ===========================================
// Event Controller
// ===========================================
// Handles HTTP requests for event (audit log) operations.

import type { Request, Response } from 'express';
import type { EventListQuery, EventIdParam, PurgeEventsQuery } from '@mirthless/core-models';
import { EventService } from '../services/event.service.js';
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

export class EventController {
  static async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as EventListQuery;
    const result = await EventService.list(query);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list events');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const { id } = req.params as unknown as EventIdParam;
    const result = await EventService.getById(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, eventId: id }, 'Failed to get event');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async purge(req: Request, res: Response): Promise<void> {
    const { olderThanDays } = req.query as unknown as PurgeEventsQuery;
    const result = await EventService.purge(olderThanDays);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to purge events');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    logger.info({ olderThanDays, deleted: result.value.deleted }, 'Events purged');
    res.json({ success: true, data: result.value });
  }
}
