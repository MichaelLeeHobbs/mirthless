// ===========================================
// Channel Export/Import Controller
// ===========================================
// Handles HTTP requests for channel export and import operations.

import type { Request, Response } from 'express';
import type { ChannelImportInput } from '@mirthless/core-models';
import { ChannelExportService } from '../services/channel-export.service.js';
import { ChannelImportService } from '../services/channel-import.service.js';
import { isServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

export class ChannelExportController {
  /** Export a single channel by ID. */
  static async exportChannel(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await ChannelExportService.exportChannel(id);

    if (!result.ok) {
      if (isServiceError(result.error, 'NOT_FOUND')) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Channel not found' } });
        return;
      }
      logger.error({ error: result.error }, 'Failed to export channel');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Export failed' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  /** Export all channels. */
  static async exportAll(_req: Request, res: Response): Promise<void> {
    const result = await ChannelExportService.exportAll();

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to export all channels');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Export failed' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  /** Import channels from JSON. */
  static async importChannels(req: Request, res: Response): Promise<void> {
    const input = req.body as ChannelImportInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelImportService.importChannels(input.channels, input.collisionMode, context);

    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to import channels');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Import failed' } });
      return;
    }

    logger.info({ result: result.value }, 'Channels imported');
    res.json({ success: true, data: result.value });
  }
}
