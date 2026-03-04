// ===========================================
// Cross-Channel Search Controller
// ===========================================

import type { Request, Response } from 'express';
import { CrossChannelSearchService, type SearchFilters } from '../services/cross-channel-search.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';

export class CrossChannelSearchController {
  static async search(req: Request, res: Response): Promise<void> {
    const query = req.query;
    const filters: SearchFilters = {
      limit: Number(query['limit'] ?? 25),
      offset: Number(query['offset'] ?? 0),
      ...(query['status'] ? { status: String(query['status']) } : {}),
      ...(query['dateFrom'] ? { dateFrom: String(query['dateFrom']) } : {}),
      ...(query['dateTo'] ? { dateTo: String(query['dateTo']) } : {}),
      ...(query['channelIds'] ? { channelIds: String(query['channelIds']) } : {}),
    };

    const result = await CrossChannelSearchService.search(filters);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to search messages across channels');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }
}
