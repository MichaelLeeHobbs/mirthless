// ===========================================
// Channel Group Controller
// ===========================================
// Handles HTTP requests for channel group CRUD + member management.

import type { Request, Response } from 'express';
import type { CreateChannelGroupInput, UpdateChannelGroupInput, AddChannelGroupMemberInput } from '@mirthless/core-models';
import { ChannelGroupService } from '../services/channel-group.service.js';
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

export class ChannelGroupController {
  static async listGroups(_req: Request, res: Response): Promise<void> {
    const result = await ChannelGroupService.listGroups();

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to list channel groups');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async listMemberships(_req: Request, res: Response): Promise<void> {
    const result = await ChannelGroupService.listMemberships();

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to list group memberships');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await ChannelGroupService.getById(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, groupId: id }, 'Failed to get channel group');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateChannelGroupInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelGroupService.create(input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, name: input.name }, 'Failed to create channel group');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ groupId: result.value.id }, 'Channel group created');
    res.status(201).json({ success: true, data: result.value });
  }

  static async update(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as UpdateChannelGroupInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelGroupService.update(id, input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, groupId: id }, 'Failed to update channel group');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ groupId: id }, 'Channel group updated');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelGroupService.delete(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, groupId: id }, 'Failed to delete channel group');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ groupId: id }, 'Channel group deleted');
    res.status(204).send();
  }

  static async addMember(req: Request, res: Response): Promise<void> {
    const groupId = req.params['id'] as string;
    const { channelId } = req.body as AddChannelGroupMemberInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelGroupService.addMember(groupId, channelId, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, groupId, channelId }, 'Failed to add member');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.status(201).json({ success: true, data: null });
  }

  static async removeMember(req: Request, res: Response): Promise<void> {
    const groupId = req.params['id'] as string;
    const channelId = req.params['channelId'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelGroupService.removeMember(groupId, channelId, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ error: result.error, groupId, channelId }, 'Failed to remove member');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.status(204).send();
  }
}
