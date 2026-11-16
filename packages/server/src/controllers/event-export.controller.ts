// ===========================================
// Event Export Controller
// ===========================================
// Handles HTTP requests for exporting audit events as CSV or JSON files.

import type { Request, Response } from 'express';
import { AUDIT_ACTION, type EventExportQuery } from '@galvanigraph/core-models';
import { EventExportService } from '../services/event-export.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';
import { recordExportOrRefuse } from '../lib/audited-read.js';
import { csvHeaderLines, exportHeader, wrapJsonExport } from '../lib/export-header.js';

export class EventExportController {
  static async exportEvents(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as EventExportQuery;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const result = query.format === 'csv'
      ? await EventExportService.exportAsCsv(query)
      : await EventExportService.exportAsJson(query);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack, format: query.format }, 'Failed to export events');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    // Events hold users' sign-in addresses: every export is recorded with its
    // reason before the file goes out, and the file's header names the record
    // (D-312). Fail-closed, like every other export, so the header always can.
    const { reason, ...filters } = query;
    const auditRecordId = await recordExportOrRefuse(req, res, {
      action: AUDIT_ACTION.EVENTS_EXPORTED, attributes: { reason, filters },
    });
    if (auditRecordId === null) return;
    const header = exportHeader(req, auditRecordId, reason);

    if (query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="events-export-${timestamp}.csv"`);
      res.status(200).send(csvHeaderLines(header) + result.value);
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="events-export-${timestamp}.json"`);
    res.status(200).send(wrapJsonExport(header, 'events', result.value));
  }
}
