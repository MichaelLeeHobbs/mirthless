// ===========================================
// Message Export Controller
// ===========================================
// Streams channel message metadata as CSV or JSON. This is a PHI read (the
// export lists message metadata, and optionally raw content), so every export
// emits a MESSAGES_EXPORTED audit event.

import type { Request, Response } from 'express';
import type { MessageExportQuery } from '@mirthless/core-models';
import { MessageExportService } from '../services/message-export.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { emitEvent } from '../lib/event-emitter.js';
import logger from '../lib/logger.js';

export class MessageExportController {
  /** GET /channels/:id/messages/export — CSV/JSON metadata export. */
  static async exportMessages(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const query = req.query as unknown as MessageExportQuery;

    const result = await MessageExportService.collect(channelId, query);
    if (!result.ok) {
      logger.error({ errMsg: result.error.message, channelId }, 'Failed to export messages');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    const data = result.value;

    // HIPAA audit: exporting message metadata (and optionally content) is a PHI read.
    emitEvent({
      level: 'INFO', name: 'MESSAGES_EXPORTED', outcome: 'SUCCESS',
      userId: req.user?.id ?? null, channelId,
      serverId: null, ipAddress: req.ip ?? null,
      attributes: {
        format: query.format,
        exported: data.rows.length,
        total: data.total,
        truncated: data.truncated,
        includeContent: query.includeContent,
      },
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('X-Export-Truncated', String(data.truncated));
    res.setHeader('X-Export-Count', String(data.rows.length));

    if (query.format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="messages-${channelId}-${timestamp}.json"`);
      res.status(200).send(MessageExportService.toJson(data, query.includeContent));
      return;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="messages-${channelId}-${timestamp}.csv"`);
    res.status(200).send(MessageExportService.toCsv(data, query.includeContent));
  }
}
