// ===========================================
// Event Export Controller
// ===========================================
// Handles HTTP requests for exporting audit events as CSV or JSON files.

import type { Request, Response } from 'express';
import { AUDIT_ACTION, type EventExportQuery } from '@galvanigraph/core-models';
import { EventExportService } from '../services/event-export.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';
import { recordReadBestEffort } from '../lib/audited-read.js';

export class EventExportController {
  static async exportEvents(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as EventExportQuery;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    // Events hold users' client addresses: every export is recorded, best effort (D-312).
    const record = (): void => { recordReadBestEffort(req, { action: AUDIT_ACTION.EVENTS_EXPORTED, attributes: { query } }); };

    if (query.format === 'csv') {
      const result = await EventExportService.exportAsCsv(query);

      if (!result.ok) {
        logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to export events as CSV');
        res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
        return;
      }

      record();
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="events-export-${timestamp}.csv"`);
      res.status(200).send(result.value);
      return;
    }

    const result = await EventExportService.exportAsJson(query);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to export events as JSON');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    record();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="events-export-${timestamp}.json"`);
    res.status(200).send(result.value);
  }
}
