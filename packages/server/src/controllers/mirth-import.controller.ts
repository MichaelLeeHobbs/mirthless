// ===========================================
// Mirth Connect XML Import Controller
// ===========================================
// Handles HTTP requests for importing Mirth Connect XML channel exports.

import type { Request, Response } from 'express';
import type { MirthImportInput } from '@mirthless/core-models';
import { MirthImportService } from '../services/mirth-import.service.js';
import logger from '../lib/logger.js';

export class MirthImportController {
  /** Import channels from Mirth Connect XML. */
  static async importFromXml(req: Request, res: Response): Promise<void> {
    const input = req.body as MirthImportInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };

    const result = await MirthImportService.importFromXml(
      input.xml,
      input.collisionMode,
      input.dryRun,
      context,
    );

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Mirth Connect XML import failed');
      res.status(400).json({
        success: false,
        error: { code: 'IMPORT_FAILED', message: result.error.message ?? 'Failed to import Mirth Connect XML' },
      });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  /** Preview conversion of Mirth Connect XML (dry run). */
  static async preview(req: Request, res: Response): Promise<void> {
    const input = req.body as MirthImportInput;

    const convertResult = MirthImportService.convertXml(input.xml);

    if (!convertResult.ok) {
      logger.error({ errMsg: convertResult.error.message, stack: convertResult.error.stack }, 'Mirth Connect XML preview failed');
      res.status(400).json({
        success: false,
        error: { code: 'PARSE_FAILED', message: convertResult.error.message ?? 'Failed to parse Mirth Connect XML' },
      });
      return;
    }

    res.json({ success: true, data: convertResult.value });
  }
}
