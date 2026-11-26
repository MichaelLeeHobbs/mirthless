import type { Request, Response } from 'express';
import type { PurgeDeletedChannelInput } from '@galvanigraph/core-models';
import { DataPrunerService } from '../services/data-pruner.service.js';
import { DeletedChannelService } from '../services/deleted-channel.service.js';
import { SWEEP_BUDGET_MS } from '../services/leftover-rows.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';
import { channelScopeOf } from '../lib/channel-scope.js';

function auditContext(req: Request): { userId: string | null; ipAddress: string | null } {
  return {
    userId: req.user?.id ?? null,
    ipAddress: req.ip ?? null,
  };
}

export class DataPrunerController {
  static async pruneAll(req: Request, res: Response): Promise<void> {
    const result = await DataPrunerService.pruneAll(auditContext(req), SWEEP_BUDGET_MS.REQUEST);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to prune all channels');
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL', message: 'Internal server error' },
      });
      return;
    }

    if (result.value.failedChannelIds.length > 0 || result.value.expiredRecordsFailed) {
      logger.error({ result: result.value }, 'Data pruner completed, but not everything could be pruned');
    } else {
      logger.info({ result: result.value }, 'Data pruner completed');
    }
    res.json({ success: true, data: result.value });
  }

  static async pruneChannel(req: Request, res: Response): Promise<void> {
    const channelId = req.params['channelId'] as string;
    const maxAgeDays = (req.body as { maxAgeDays: number }).maxAgeDays;

    const result = await DataPrunerService.pruneChannel(
      channelId,
      maxAgeDays,
      auditContext(req),
    );

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({
        success: false,
        error: errorResponse(result.error),
      });
      return;
    }

    logger.info({ channelId, deletedCount: result.value.deletedCount }, 'Channel pruned');
    res.json({ success: true, data: result.value });
  }

  static async getStatistics(req: Request, res: Response): Promise<void> {
    const result = await DataPrunerService.getStatistics(await channelScopeOf(req, 'settings:read'));

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to get pruner statistics');
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL', message: 'Internal server error' },
      });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async listDeletedChannels(req: Request, res: Response): Promise<void> {
    const result = await DeletedChannelService.list(await channelScopeOf(req, 'settings:read'));
    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list deleted channels');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    res.json({ success: true, data: result.value });
  }

  static async purgeDeletedChannel(req: Request, res: Response): Promise<void> {
    const channelId = req.params['channelId'] as string;
    const { reason } = req.body as PurgeDeletedChannelInput;
    const result = await DeletedChannelService.purge(channelId, reason, auditContext(req));
    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger[status >= 500 ? 'error' : 'warn']({ channelId, errMsg: result.error.message, stack: result.error.stack }, 'The messages of a deleted channel were not removed');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    logger.warn({ channelId, ...result.value }, 'All messages of a deleted channel were removed');
    res.json({ success: true, data: result.value });
  }
}
