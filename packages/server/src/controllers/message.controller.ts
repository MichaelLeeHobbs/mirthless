// ===========================================
// Message Controller
// ===========================================
// HTTP adapter for message search, detail, and deletion.

import type { Request, Response } from 'express';
import type { MessageSearchQuery } from '@mirthless/core-models';
import { MessageQueryService } from '../services/message-query.service.js';
import { isServiceError } from '../lib/service-error.js';
import { emitEvent } from '../lib/event-emitter.js';
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

    // HIPAA audit: searching messages (esp. contentSearch) touches PHI.
    emitEvent({
      level: 'INFO', name: 'MESSAGE_SEARCHED', outcome: 'SUCCESS',
      userId: req.user?.id ?? null, channelId,
      serverId: null, ipAddress: req.ip ?? null,
      attributes: { contentSearch: filters.contentSearch !== undefined && filters.contentSearch.length > 0, resultCount: result.value.total },
    });

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

    // HIPAA audit: message detail returns raw/transformed/sent content (PHI).
    emitEvent({
      level: 'INFO', name: 'MESSAGE_CONTENT_VIEWED', outcome: 'SUCCESS',
      userId: req.user?.id ?? null, channelId,
      serverId: null, ipAddress: req.ip ?? null,
      attributes: { messageId: msgId },
    });

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

    // HIPAA audit: deleting a message destroys PHI and must be recorded, like
    // content view/search/export.
    emitEvent({
      level: 'WARN', name: 'MESSAGE_DELETED', outcome: 'SUCCESS',
      userId: req.user?.id ?? null, channelId,
      serverId: null, ipAddress: req.ip ?? null,
      attributes: { messageId: msgId },
    });

    logger.info({ channelId, msgId }, 'Message deleted');
    res.status(204).send();
  }
}
