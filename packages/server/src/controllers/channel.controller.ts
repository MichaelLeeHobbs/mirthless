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
import { redactConnectorProperties } from '../lib/secret-redaction.js';
import logger from '../lib/logger.js';

/**
 * Mask connector credentials (DB/SFTP passwords, API keys, private keys) in a
 * channel detail for read-only callers. Only a caller who can already edit the
 * channel (`channels:write`) sees the real values; everyone else — notably the
 * `viewer` role — gets the redacted marker.
 */
function redactChannelDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const source = detail['sourceConnectorProperties'];
  const destinations = detail['destinations'];
  return {
    ...detail,
    sourceConnectorProperties:
      source && typeof source === 'object'
        ? redactConnectorProperties(source as Record<string, unknown>)
        : source,
    destinations: Array.isArray(destinations)
      ? destinations.map((d: Record<string, unknown>) => {
          const props = d['properties'];
          return props && typeof props === 'object'
            ? { ...d, properties: redactConnectorProperties(props as Record<string, unknown>) }
            : d;
        })
      : destinations,
  };
}

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  if (isServiceError(error, 'ALREADY_EXISTS')) return 409;
  if (isServiceError(error, 'CONFLICT')) return 409;
  if (isServiceError(error, 'NOT_SUPPORTED')) return 422;
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
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list channels');
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

    const canWrite = req.user?.permissions.includes('channels:write') ?? false;
    const data = canWrite
      ? result.value
      : redactChannelDetail(result.value as unknown as Record<string, unknown>);

    res.json({ success: true, data });
  }

  static async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateChannelInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelService.create(input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelName: input.name }, 'Failed to create channel');
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
      logger.warn({ errMsg: result.error.message, channelId: id }, 'Failed to update channel');
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
      logger.warn({ errMsg: result.error.message, channelId: id }, 'Failed to delete channel');
      res.status(status).json({ success: false, error: { code: isServiceError(result.error) ? result.error.code : 'INTERNAL', message: errorMessage(result.error) } });
      return;
    }

    logger.info({ channelId: id }, 'Channel deleted');
    res.status(204).send();
  }

  static async clone(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const { name } = req.body as { name: string };
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelService.clone(id, name, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId: id }, 'Failed to clone channel');
      res.status(status).json({ success: false, error: { code: isServiceError(result.error) ? result.error.code : 'INTERNAL', message: errorMessage(result.error) } });
      return;
    }

    logger.info({ channelId: result.value.id, clonedFrom: id }, 'Channel cloned');
    res.status(201).json({ success: true, data: result.value });
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
