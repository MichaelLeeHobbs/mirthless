// ===========================================
// System Info Controller
// ===========================================
// Handles HTTP request for system information.

import type { Request, Response } from 'express';
import { SystemInfoService } from '../services/system-info.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';

export class SystemInfoController {
  static async getInfo(_req: Request, res: Response): Promise<void> {
    const result = await SystemInfoService.getInfo();

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to get system info');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }
}
