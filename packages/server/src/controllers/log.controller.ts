import type { Request, Response } from 'express';
import { AUDIT_ACTION } from '@galvanigraph/core-models';
import { LogStreamService } from '../services/log-stream.service.js';
import { recordReadBestEffort } from '../lib/audited-read.js';

export class LogController {
  static getEntries(req: Request, res: Response): void {
    const query = {
      ...(req.query['level'] !== undefined ? { level: Number(req.query['level']) } : {}),
      ...(typeof req.query['search'] === 'string' ? { search: req.query['search'] } : {}),
      ...(req.query['offset'] !== undefined ? { offset: Number(req.query['offset']) } : {}),
      ...(req.query['limit'] !== undefined ? { limit: Number(req.query['limit']) } : {}),
    };
    const result = LogStreamService.query(query);

    // Error text from scripts and connectors can hold PHI: recorded, best effort (D-312).
    recordReadBestEffort(req, {
      action: AUDIT_ACTION.SERVER_LOG_READ, attributes: { query },
      // New lines on a polled page record again; the lines themselves stay out of the record.
      dedupe: { key: `server-log|${JSON.stringify(query)}`, ids: result.entries.map((e) => `${e.timestamp}|${e.message}`), idsOnlyForDedupe: true },
    });
    res.json({ success: true, data: result });
  }
}
