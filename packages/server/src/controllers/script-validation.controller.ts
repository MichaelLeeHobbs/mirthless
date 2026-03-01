// ===========================================
// Script Validation Controller
// ===========================================
// Handles HTTP request for script syntax validation.

import type { Request, Response } from 'express';
import { ScriptValidationService } from '../services/script-validation.service.js';
import logger from '../lib/logger.js';

export class ScriptValidationController {
  static async validate(req: Request, res: Response): Promise<void> {
    const { script, language } = req.body as {
      script: string;
      language: 'javascript' | 'typescript';
    };

    const result = await ScriptValidationService.validate(script, language);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Script validation service error');
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Script validation failed' },
      });
      return;
    }

    res.json({ success: true, data: result.value });
  }
}
