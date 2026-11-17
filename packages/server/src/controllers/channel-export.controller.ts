// ===========================================
// Channel Export/Import Controller
// ===========================================
// Handles HTTP requests for channel export and import operations.

import type { Request, Response } from 'express';
import type { ChannelImportInput } from '@galvanigraph/core-models';
import { ChannelExportService } from '../services/channel-export.service.js';
import { ChannelImportService } from '../services/channel-import.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';
import { channelScopeOf } from '../lib/channel-scope.js';

export class ChannelExportController {
  /** Export a single channel by ID. */
  static async exportChannel(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelExportService.exportChannel(id, context);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack, channelId: id }, 'Failed to export channel');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  /** Export all channels. */
  static async exportAll(req: Request, res: Response): Promise<void> {
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelExportService.exportAll(context, await channelScopeOf(req, 'channels:read'));

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to export all channels');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Export failed' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  /** Import channels from JSON. */
  static async importChannels(req: Request, res: Response): Promise<void> {
    const input = req.body as ChannelImportInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const placement = input.groupId === undefined ? {} : { groupId: input.groupId };
    const result = await ChannelImportService.importChannels(input.channels, input.collisionMode, context, placement);

    if (!result.ok) {
      // A group the caller cannot use answers 400/403/404; anything else is 500.
      const status = mapErrorToStatus(result.error);
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to import channels');
      res.status(status).json({ success: false, error: status === 500 ? { code: 'INTERNAL', message: 'Import failed' } : errorResponse(result.error) });
      return;
    }

    logger.info({ result: result.value }, 'Channels imported');
    res.json({ success: true, data: result.value });
  }
}
