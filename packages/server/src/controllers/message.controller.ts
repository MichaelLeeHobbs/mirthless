// ===========================================
// Message Controller
// ===========================================
// HTTP adapter for message search, detail, and deletion.

import type { Request, Response } from 'express';
import type { MessageSearchQuery } from '@mirthless/core-models';
import { MessageQueryService } from '../services/message-query.service.js';
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

export class MessageController {
  /** GET /channels/:id/messages — Search messages with filters and pagination. */
  static async search(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const filters = req.query as unknown as MessageSearchQuery;
    const result = await MessageQueryService.searchMessages(channelId, filters);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId }, 'Failed to search messages');
      res.status(status).json({ success: false, error: { code: errorCode(result.error), message: errorMessage(result.error) } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  /** GET /channels/:id/messages/:msgId — Get message detail with all content. */
  static async getDetail(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const msgId = Number(req.params['msgId']);
    const result = await MessageQueryService.getMessageDetail(channelId, msgId);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: { code: errorCode(result.error), message: errorMessage(result.error) } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  /** DELETE /channels/:id/messages/:msgId — Delete message and related data. */
  static async delete(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const msgId = Number(req.params['msgId']);
    const result = await MessageQueryService.deleteMessage(channelId, msgId);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId, msgId }, 'Failed to delete message');
      res.status(status).json({ success: false, error: { code: errorCode(result.error), message: errorMessage(result.error) } });
      return;
    }

    logger.info({ channelId, msgId }, 'Message deleted');
    res.status(204).send();
  }
}
