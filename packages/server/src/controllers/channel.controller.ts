// ===========================================
// Channel Controller
// ===========================================
// Handles HTTP requests for channel CRUD operations.
// Validates input, calls service, formats responses.

import type { Request, Response } from 'express';
import type {
  CreateChannelInput,
  UpdateChannelInput,
  ChannelListQuery,
  PatchChannelEnabledInput,
} from '@mirthless/core-models';
import { ChannelService } from '../services/channel.service.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  if (isServiceError(error, 'ALREADY_EXISTS')) return 409;
  if (isServiceError(error, 'CONFLICT')) return 409;
  return 500;
}

function errorMessage(error: unknown): string {
  if (isServiceError(error)) return error.message;
  return 'Internal server error';
}

export class ChannelController {
  static async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as ChannelListQuery;
    const result = await ChannelService.list(query);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to list channels');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await ChannelService.getById(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: { code: 'NOT_FOUND', message: errorMessage(result.error) } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateChannelInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelService.create(input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, channelName: input.name }, 'Failed to create channel');
      res.status(status).json({ success: false, error: { code: isServiceError(result.error) ? result.error.code : 'INTERNAL', message: errorMessage(result.error) } });
      return;
    }

    logger.info({ channelId: result.value.id }, 'Channel created');
    res.status(201).json({ success: true, data: result.value });
  }

  static async update(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as UpdateChannelInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelService.update(id, input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, channelId: id }, 'Failed to update channel');
      res.status(status).json({ success: false, error: { code: isServiceError(result.error) ? result.error.code : 'INTERNAL', message: errorMessage(result.error) } });
      return;
    }

    logger.info({ channelId: id }, 'Channel updated');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelService.delete(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, channelId: id }, 'Failed to delete channel');
      res.status(status).json({ success: false, error: { code: isServiceError(result.error) ? result.error.code : 'INTERNAL', message: errorMessage(result.error) } });
      return;
    }

    logger.info({ channelId: id }, 'Channel deleted');
    res.status(204).send();
  }

  static async setEnabled(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const { enabled } = req.body as PatchChannelEnabledInput;
    const result = await ChannelService.setEnabled(id, enabled);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: { code: isServiceError(result.error) ? result.error.code : 'INTERNAL', message: errorMessage(result.error) } });
      return;
    }

    logger.info({ channelId: id, enabled }, 'Channel enabled toggled');
    res.json({ success: true, data: result.value });
  }
}
