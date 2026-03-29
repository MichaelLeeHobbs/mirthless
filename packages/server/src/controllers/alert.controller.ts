// ===========================================
// Alert Controller
// ===========================================
// Handles HTTP requests for alert CRUD operations.

import type { Request, Response } from 'express';
import type {
  CreateAlertInput,
  UpdateAlertInput,
  AlertListQuery,
  PatchAlertEnabledInput,
} from '@mirthless/core-models';
import { AlertService } from '../services/alert.service.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  if (isServiceError(error, 'ALREADY_EXISTS')) return 409;
  if (isServiceError(error, 'CONFLICT')) return 409;
  return 500;
}

function errorResponse(error: unknown): { code: string; message: string } {
  if (isServiceError(error)) return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: 'Internal server error' };
}

export class AlertController {
  static async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as AlertListQuery;
    const result = await AlertService.list(query);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list alerts');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await AlertService.getById(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, alertId: id }, 'Failed to get alert');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateAlertInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await AlertService.create(input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, name: input.name }, 'Failed to create alert');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ alertId: result.value.id }, 'Alert created');
    res.status(201).json({ success: true, data: result.value });
  }

  static async update(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as UpdateAlertInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await AlertService.update(id, input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, alertId: id }, 'Failed to update alert');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ alertId: id }, 'Alert updated');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await AlertService.delete(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, alertId: id }, 'Failed to delete alert');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ alertId: id }, 'Alert deleted');
    res.status(204).send();
  }

  static async setEnabled(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const { enabled } = req.body as PatchAlertEnabledInput;
    const result = await AlertService.setEnabled(id, enabled);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, alertId: id }, 'Failed to toggle alert enabled');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ alertId: id, enabled }, 'Alert enabled state changed');
    res.json({ success: true, data: result.value });
  }
}
