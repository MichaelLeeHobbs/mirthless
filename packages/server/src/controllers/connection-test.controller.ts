// ===========================================
// Connection Test Controller
// ===========================================
// Handles HTTP request for connector connection testing.

import type { Request, Response } from 'express';
import type { ConnectionTestInput } from '@mirthless/core-models';
import { ConnectionTestService } from '../services/connection-test.service.js';
import { isServiceError } from '../lib/service-error.js';
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
      const status = isServiceError(result.error, 'INVALID_INPUT') ? 400 : 500;
      logger.warn({ error: result.error, connectorType, mode }, 'Connection test failed');
      res.status(status).json({
        success: false,
        error: isServiceError(result.error)
          ? { code: result.error.code, message: result.error.message }
          : { code: 'INTERNAL', message: 'Connection test failed' },
      });
      return;
    }

    res.json({ success: true, data: result.value });
  }
}
