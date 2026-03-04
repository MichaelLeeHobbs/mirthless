// ===========================================
// Message Generator Controller
// ===========================================

import type { Request, Response } from 'express';
import type { GenerateMessagesInput } from '@mirthless/core-models';
import { MessageGeneratorService } from '../services/message-generator.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';

export class MessageGeneratorController {
  static generate(req: Request, res: Response): void {
    const input = req.body as GenerateMessagesInput;
    const result = MessageGeneratorService.generate(input);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to generate messages');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }
}
