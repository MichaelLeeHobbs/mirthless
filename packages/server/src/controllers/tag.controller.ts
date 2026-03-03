// ===========================================
// Tag Controller
// ===========================================
// Handles HTTP requests for channel tag CRUD + assignment.

import type { Request, Response } from 'express';
import type { CreateTagInput, UpdateTagInput, AssignTagInput } from '@mirthless/core-models';
import { TagService } from '../services/tag.service.js';
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

export class TagController {
  static async listTags(_req: Request, res: Response): Promise<void> {
    const result = await TagService.listTags();

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to list tags');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async listAssignments(_req: Request, res: Response): Promise<void> {
    const result = await TagService.listAssignments();

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to list tag assignments');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateTagInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await TagService.create(input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, name: input.name }, 'Failed to create tag');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ tagId: result.value.id }, 'Tag created');
    res.status(201).json({ success: true, data: result.value });
  }

  static async update(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as UpdateTagInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await TagService.update(id, input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, tagId: id }, 'Failed to update tag');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ tagId: id }, 'Tag updated');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await TagService.delete(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, tagId: id }, 'Failed to delete tag');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ tagId: id }, 'Tag deleted');
    res.status(204).send();
  }

  static async assign(req: Request, res: Response): Promise<void> {
    const tagId = req.params['id'] as string;
    const { channelId } = req.body as AssignTagInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await TagService.assign(tagId, channelId, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, tagId, channelId }, 'Failed to assign tag');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.status(201).json({ success: true, data: null });
  }

  static async unassign(req: Request, res: Response): Promise<void> {
    const tagId = req.params['id'] as string;
    const channelId = req.params['channelId'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await TagService.unassign(tagId, channelId, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, tagId, channelId }, 'Failed to unassign tag');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.status(204).send();
  }
}
