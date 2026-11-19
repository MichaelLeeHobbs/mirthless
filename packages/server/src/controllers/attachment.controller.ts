import type { Request, Response } from 'express';
import { AUDIT_ACTION } from '@galvanigraph/core-models';
import { AttachmentService } from '../services/attachment.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { recordReadOrRefuse } from '../lib/audited-read.js';
import logger from '../lib/logger.js';

export class AttachmentController {
  static async list(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const messageId = Number(req.params['msgId'] as string);
    const result = await AttachmentService.listByMessage(channelId, messageId);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack, channelId, messageId }, 'Failed to list attachments');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const messageId = Number(req.params['msgId'] as string);
    const attachmentId = req.params['attachmentId'] as string;
    const result = await AttachmentService.getById(channelId, messageId, attachmentId);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId, messageId, attachmentId }, 'Failed to get attachment');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    // Attachment content is PHI: recorded before it is sent, every time.
    const recorded = await recordReadOrRefuse(req, res, {
      action: AUDIT_ACTION.ATTACHMENT_DOWNLOADED, channelId, attributes: { messageId, attachmentId }, rows: 1,
    });
    if (!recorded) return;

    res.json({ success: true, data: result.value });
  }
}
