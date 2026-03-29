// ===========================================
// Message Reprocess Controller
// ===========================================

import type { Request, Response } from 'express';
import type { BulkDeleteInput } from '@mirthless/core-models';
import { MessageReprocessService } from '../services/message-reprocess.service.js';
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

export class MessageReprocessController {
  static async reprocess(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const messageId = Number(req.params['msgId']);
    const result = await MessageReprocessService.reprocessMessage(channelId, messageId);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId, messageId }, 'Failed to get raw content for reprocess');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async bulkDelete(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const input = req.body as BulkDeleteInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await MessageReprocessService.bulkDelete(channelId, input.messageIds, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId }, 'Failed to bulk delete messages');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId, deletedCount: result.value.deletedCount }, 'Messages bulk deleted');
    res.json({ success: true, data: result.value });
  }
}
