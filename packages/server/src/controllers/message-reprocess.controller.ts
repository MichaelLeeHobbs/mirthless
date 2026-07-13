// ===========================================
// Message Reprocess Controller
// ===========================================

import type { Request, Response } from 'express';
import type { BulkDeleteInput, BulkReprocessInput } from '@mirthless/core-models';
import { MessageReprocessService } from '../services/message-reprocess.service.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  if (isServiceError(error, 'CONFLICT')) return 409;
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
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await MessageReprocessService.reprocessMessage(channelId, messageId, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId, messageId }, 'Failed to reprocess message');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId, messageId, newMessageId: result.value.newMessageId }, 'Message reprocessed');
    res.json({ success: true, data: result.value });
  }

  static async bulkReprocess(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const input = req.body as BulkReprocessInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await MessageReprocessService.bulkReprocess(channelId, input.messageIds, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId }, 'Failed to bulk reprocess messages');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId, requested: result.value.requested, reprocessed: result.value.reprocessed }, 'Messages bulk reprocessed');
    res.json({ success: true, data: result.value });
  }

  static async resend(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const messageId = Number(req.params['msgId']);
    const metaDataId = Number(req.params['metaDataId']);
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await MessageReprocessService.resendDestination(channelId, messageId, metaDataId, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId, messageId, metaDataId }, 'Failed to resend destination');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId, messageId, metaDataId }, 'Destination resend queued');
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
