import type { Request, Response } from 'express';
import { AUDIT_ACTION, type MessageExportQuery } from '@galvanigraph/core-models';
import { MessageExportService } from '../services/message-export.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { recordExportOrRefuse } from '../lib/audited-read.js';
import { csvHeaderLines, exportHeader, wrapJsonExport } from '../lib/export-header.js';
import logger from '../lib/logger.js';

export class MessageExportController {
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

    // An export is a PHI read: recorded, with its reason and every exported id,
    // before the file goes out, and never deduped (D-312). The file's header
    // names that record.
    const auditRecordId = await recordExportOrRefuse(req, res, {
      action: AUDIT_ACTION.MESSAGES_EXPORTED, channelId,
      attributes: {
        reason: query.reason,
        format: query.format,
        exported: data.rows.length,
        total: data.total,
        truncated: data.truncated,
        includeContent: query.includeContent,
        messageIds: data.rows.map((r) => r.messageId),
      },
      rows: data.rows.length,
    });
    if (auditRecordId === null) return;
    const header = exportHeader(req, auditRecordId, query.reason);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('X-Export-Truncated', String(data.truncated));
    res.setHeader('X-Export-Count', String(data.rows.length));

    if (query.format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="messages-${channelId}-${timestamp}.json"`);
      res.status(200).send(wrapJsonExport(header, 'messages', MessageExportService.toJson(data, query.includeContent)));
      return;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="messages-${channelId}-${timestamp}.csv"`);
    res.status(200).send(csvHeaderLines(header) + MessageExportService.toCsv(data, query.includeContent));
  }
}
