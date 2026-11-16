// ===========================================
// Audit Controller
// ===========================================
// Reads of the protected audit log (D-312). Guarded by audit:read.

import type { Request, Response } from 'express';
import type { AuditIdParam, AuditListQuery } from '@galvanigraph/core-models';
import { AuditService } from '../services/audit.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';

export class AuditController {
  /** GET /audit: audit rows, newest first, filtered. */
  static async list(req: Request, res: Response): Promise<void> {
    const result = await AuditService.list(req.query as unknown as AuditListQuery);
    if (!result.ok) {
      logger.error({ errMsg: result.error.message }, 'Failed to list audit records');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    res.json({ success: true, data: result.value });
  }

  /** GET /audit/:id: one audit row. */
  static async getById(req: Request, res: Response): Promise<void> {
    const { id } = req.params as unknown as AuditIdParam;
    const result = await AuditService.getById(id);
    if (!result.ok) {
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    res.json({ success: true, data: result.value });
  }
}
