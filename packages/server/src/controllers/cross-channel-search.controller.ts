// ===========================================
// Cross-Channel Search Controller
// ===========================================

import type { Request, Response } from 'express';
import { CrossChannelSearchService, type SearchFilters } from '../services/cross-channel-search.service.js';
import { AUDIT_ACTION } from '@galvanigraph/core-models';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { recordReadOrRefuse } from '../lib/audited-read.js';
import logger from '../lib/logger.js';
import { channelScopeOf } from '../lib/channel-scope.js';

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

    const result = await CrossChannelSearchService.search(filters, await channelScopeOf(req, 'messages:read'));

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to search messages across channels');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    // Lists messages across channels: recorded before it is sent (D-312).
    const recorded = await recordReadOrRefuse(req, res, {
      action: AUDIT_ACTION.MESSAGES_SEARCHED_ALL_CHANNELS,
      attributes: { filters, total: result.value.total },
      dedupe: { key: `traffic|${JSON.stringify(filters)}`, ids: result.value.items.map((i) => `${i.channelId}:${String(i.messageId)}`) },
    });
    if (!recorded) return;

    res.json({ success: true, data: result.value });
  }
}
