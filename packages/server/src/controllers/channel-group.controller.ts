import type { Request, Response } from 'express';
import type { CreateChannelGroupInput, UpdateChannelGroupInput, SetChannelGroupsInput } from '@galvanigraph/core-models';
import { ChannelGroupService } from '../services/channel-group.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';
import { channelScopeOf, inScope } from '../lib/channel-scope.js';
import { ALL_CHANNELS } from '@galvanigraph/core-models';
import { deny, DENY_REASON } from '../middleware/permission.middleware.js';

/** Groups are an access boundary (D-310): creating, renaming or deleting one needs channels:write on every channel. */
function writesEveryChannel(req: Request, res: Response): boolean {
  if (req.principal?.grants.get('channels:write') === ALL_CHANNELS) return true;
  deny(req, res, DENY_REASON.NO_PERMISSION);
  return false;
}

export class ChannelGroupController {
  static async listGroups(_req: Request, res: Response): Promise<void> {
    const result = await ChannelGroupService.listGroups();

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list channel groups');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async listMemberships(req: Request, res: Response): Promise<void> {
    const result = await ChannelGroupService.listMemberships();
    const scope = await channelScopeOf(req, 'channels:read');

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list group memberships');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value.filter((m) => inScope(scope, m.channelId)) });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await ChannelGroupService.getById(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, groupId: id }, 'Failed to get channel group');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    // Channels outside the caller's scope show only as a count (D-310).
    const scope = await channelScopeOf(req, 'channels:read');
    const visible = result.value.channels.filter((c) => inScope(scope, c.id));
    res.json({
      success: true,
      data: { ...result.value, channels: visible, memberCount: visible.length, outsideScope: result.value.channels.length - visible.length },
    });
  }

  static async create(req: Request, res: Response): Promise<void> {
    if (!writesEveryChannel(req, res)) return;
    const input = req.body as CreateChannelGroupInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelGroupService.create(input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, name: input.name }, 'Failed to create channel group');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ groupId: result.value.id }, 'Channel group created');
    res.status(201).json({ success: true, data: result.value });
  }

  static async update(req: Request, res: Response): Promise<void> {
    if (!writesEveryChannel(req, res)) return;
    const id = req.params['id'] as string;
    const input = req.body as UpdateChannelGroupInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelGroupService.update(id, input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, groupId: id }, 'Failed to update channel group');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ groupId: id }, 'Channel group updated');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    if (!writesEveryChannel(req, res)) return;
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelGroupService.delete(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, groupId: id }, 'Failed to delete channel group');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ groupId: id }, 'Channel group deleted');
    res.status(204).send();
  }

  static async setChannelGroups(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const { groupIds } = req.body as SetChannelGroupsInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelGroupService.setChannelGroups(channelId, groupIds, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId }, 'Failed to set channel groups');
      // A refused grant names the permissions the actor lacks on the channel.
      const details = isServiceError(result.error) ? result.error.details : undefined;
      res.status(status).json({ success: false, error: { ...errorResponse(result.error), ...(details ? { details } : {}) } });
      return;
    }

    res.json({ success: true, data: result.value });
  }
}
