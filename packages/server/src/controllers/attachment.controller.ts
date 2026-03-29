// ===========================================
// Attachment Controller
// ===========================================
// Handles HTTP requests for message attachment queries.

import type { Request, Response } from 'express';
import { AttachmentService } from '../services/attachment.service.js';
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

export class AttachmentController {
  static async list(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const messageId = Number(req.params['msgId'] as string);
    const result = await AttachmentService.listByMessage(channelId, messageId);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack, channelId, messageId }, 'Failed to list attachments');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
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

    res.json({ success: true, data: result.value });
  }
}
