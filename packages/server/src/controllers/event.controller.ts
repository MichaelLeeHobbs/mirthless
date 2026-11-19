import type { Request, Response } from 'express';
import { AUDIT_ACTION, type EventListQuery, type EventIdParam, type PurgeEventsQuery } from '@galvanigraph/core-models';
import { EventService } from '../services/event.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';
import { recordReadBestEffort } from '../lib/audited-read.js';
import { channelScopeOf } from '../lib/channel-scope.js';

export class EventController {
  static async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as EventListQuery;
    const result = await EventService.list(query, await channelScopeOf(req, 'events:read'));

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list events');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    // A search of the events table: recorded, best effort (D-312).
    recordReadBestEffort(req, {
      action: AUDIT_ACTION.EVENTS_SEARCHED, attributes: { query, total: result.value.pagination.total },
      dedupe: { key: `events|${JSON.stringify(query)}`, ids: result.value.data.map((e) => e.id) },
    });
    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const { id } = req.params as unknown as EventIdParam;
    const result = await EventService.getById(id, await channelScopeOf(req, 'events:read'));

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
    const result = await EventService.purge(olderThanDays, { userId: req.user?.id ?? null, ipAddress: req.ip ?? null });

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to purge events');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ olderThanDays, deleted: result.value.deleted }, 'Events purged');
    res.json({ success: true, data: result.value });
  }
}
