import type { Request, Response } from 'express';
import { AUDIT_ACTION, type MessageSearchQuery } from '@galvanigraph/core-models';
import { MessageQueryService } from '../services/message-query.service.js';
import { MessageReprocessService } from '../services/message-reprocess.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { recordReadOrRefuse } from '../lib/audited-read.js';
import logger from '../lib/logger.js';

export class MessageController {
  static async search(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const filters = req.query as unknown as MessageSearchQuery;
    const result = await MessageQueryService.searchMessages(channelId, filters);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId }, 'Failed to search messages');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    // A PHI read: recorded before the list goes out, with the term as typed (D-312).
    const { contentSearch, ...rest } = filters;
    const recorded = await recordReadOrRefuse(req, res, {
      action: AUDIT_ACTION.MESSAGE_SEARCHED, channelId,
      attributes: { term: contentSearch ?? null, filters: rest, total: result.value.total },
      rows: result.value.items.length,
      dedupe: { key: `search|${channelId}|${JSON.stringify(filters)}`, ids: result.value.items.map((m) => m.messageId) },
    });
    if (!recorded) return;

    res.json({ success: true, data: result.value });
  }

  static async getDetail(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const msgId = Number(req.params['msgId']);
    const result = await MessageQueryService.getMessageDetail(channelId, msgId);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    // Message detail returns raw, transformed and sent content (PHI): recorded first.
    const recorded = await recordReadOrRefuse(req, res, {
      action: AUDIT_ACTION.MESSAGE_CONTENT_VIEWED, channelId,
      attributes: { messageId: msgId },
      dedupe: { key: `detail|${channelId}|${String(msgId)}`, ids: [msgId] },
      rows: 1,
    });
    if (!recorded) return;

    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const msgId = Number(req.params['msgId']);
    const result = await MessageReprocessService.deleteMessage(channelId, msgId, { userId: req.user?.id ?? null, ipAddress: req.ip ?? null });

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId, msgId }, 'Failed to delete message');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId, msgId }, 'Message deleted');
    res.status(204).send();
  }
}
