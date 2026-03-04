// ===========================================
// Global Script Controller
// ===========================================
// Handles HTTP requests for global scripts GET/PUT.

import type { Request, Response } from 'express';
import type { UpdateGlobalScriptsInput } from '@mirthless/core-models';
import { GlobalScriptService } from '../services/global-script.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';

export class GlobalScriptController {
  static async getAll(_req: Request, res: Response): Promise<void> {
    const result = await GlobalScriptService.getAll();

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to get global scripts');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async update(req: Request, res: Response): Promise<void> {
    const input = req.body as UpdateGlobalScriptsInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await GlobalScriptService.update(input, context);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to update global scripts');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info('Global scripts updated');
    res.json({ success: true, data: result.value });
  }
}
