// ===========================================
// Log Controller
// ===========================================
// Handles HTTP requests for server log queries.

import type { Request, Response } from 'express';
import { LogStreamService } from '../services/log-stream.service.js';

export class LogController {
  static getEntries(req: Request, res: Response): void {
    const result = LogStreamService.query({
      ...(req.query['level'] !== undefined ? { level: Number(req.query['level']) } : {}),
      ...(typeof req.query['search'] === 'string' ? { search: req.query['search'] } : {}),
      ...(req.query['offset'] !== undefined ? { offset: Number(req.query['offset']) } : {}),
      ...(req.query['limit'] !== undefined ? { limit: Number(req.query['limit']) } : {}),
    });

    res.json({ success: true, data: result });
  }
}
