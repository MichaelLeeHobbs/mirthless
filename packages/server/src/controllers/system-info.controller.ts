// ===========================================
// System Info Controller
// ===========================================
// Handles HTTP request for system information.

import type { Request, Response } from 'express';
import { SystemInfoService } from '../services/system-info.service.js';
import logger from '../lib/logger.js';

export class SystemInfoController {
  static async getInfo(_req: Request, res: Response): Promise<void> {
    const result = await SystemInfoService.getInfo();

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to get system info');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }
}
