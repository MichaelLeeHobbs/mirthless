// ===========================================
// Resource Controller
// ===========================================
// Handles HTTP requests for resource CRUD.

import type { Request, Response } from 'express';
import type { CreateResourceInput, UpdateResourceInput } from '@mirthless/core-models';
import { ResourceService } from '../services/resource.service.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  if (isServiceError(error, 'ALREADY_EXISTS')) return 409;
  return 500;
}

function errorResponse(error: unknown): { code: string; message: string } {
  if (isServiceError(error)) return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: 'Internal server error' };
}

export class ResourceController {
  static async list(_req: Request, res: Response): Promise<void> {
    const result = await ResourceService.list();

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to list resources');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await ResourceService.getById(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, resourceId: id }, 'Failed to get resource');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateResourceInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ResourceService.create(input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, name: input.name }, 'Failed to create resource');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ resourceId: result.value.id }, 'Resource created');
    res.status(201).json({ success: true, data: result.value });
  }

  static async update(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as UpdateResourceInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ResourceService.update(id, input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, resourceId: id }, 'Failed to update resource');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ resourceId: id }, 'Resource updated');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ResourceService.delete(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, resourceId: id }, 'Failed to delete resource');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ resourceId: id }, 'Resource deleted');
    res.status(204).send();
  }
}
