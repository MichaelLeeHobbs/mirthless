// ===========================================
// Channel Revision Controller
// ===========================================
// Handles HTTP requests for channel revision history.

import type { Request, Response } from 'express';
import { ChannelRevisionService } from '../services/channel-revision.service.js';
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

export class ChannelRevisionController {
  static async list(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const result = await ChannelRevisionService.listRevisions(channelId);

    if (!result.ok) {
      logger.error({ error: result.error, channelId }, 'Failed to list revisions');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getByRevision(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const rev = Number(req.params['rev']);
    const result = await ChannelRevisionService.getRevision(channelId, rev);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, channelId, rev }, 'Failed to get revision');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }
}
