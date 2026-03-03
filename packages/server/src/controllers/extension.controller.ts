// ===========================================
// Extension Controller
// ===========================================

import type { Request, Response } from 'express';
import type { SetExtensionEnabledInput } from '@mirthless/core-models';
import { ExtensionService } from '../services/extension.service.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  return 500;
}

function errorResponse(error: unknown): { code: string; message: string } {
  if (isServiceError(error)) return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: 'Internal server error' };
}

export class ExtensionController {
  static async list(_req: Request, res: Response): Promise<void> {
    const result = await ExtensionService.list();

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to list extensions');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await ExtensionService.getById(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, extensionId: id }, 'Failed to get extension');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async setEnabled(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as SetExtensionEnabledInput;
    const result = await ExtensionService.setEnabled(id, input.enabled);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, extensionId: id }, 'Failed to set extension enabled');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ extensionId: id, enabled: input.enabled }, 'Extension enabled status updated');
    res.json({ success: true, data: result.value });
  }
}
