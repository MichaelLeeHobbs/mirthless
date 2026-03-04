// ===========================================
// Connection Test Controller
// ===========================================
// Handles HTTP request for connector connection testing.

import type { Request, Response } from 'express';
import type { ConnectionTestInput } from '@mirthless/core-models';
import { ConnectionTestService } from '../services/connection-test.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';

export class ConnectionTestController {
  static async test(req: Request, res: Response): Promise<void> {
    const { connectorType, mode, properties } = req.body as ConnectionTestInput;

    const result = await ConnectionTestService.testConnection(
      connectorType,
      mode,
      properties,
    );

    if (!result.ok) {
      logger.warn({ error: result.error, connectorType, mode }, 'Connection test failed');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }
}
