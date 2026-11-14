// ===========================================
// Server Backup Controller
// ===========================================
// Handles HTTP requests for server backup/restore.

import type { Request, Response } from 'express';
import type { BackupCollisionMode, ServerBackup } from '@galvaniflow/core-models';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { ServerBackupService } from '../services/server-backup.service.js';
import logger from '../lib/logger.js';

export class ServerBackupController {
  static async exportBackup(req: Request, res: Response): Promise<void> {
    const result = await ServerBackupService.exportBackup({ userId: req.user?.id ?? null, ipAddress: req.ip ?? null });

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to export backup');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async restoreBackup(req: Request, res: Response): Promise<void> {
    const { backup, collisionMode } = req.body as { backup: ServerBackup; collisionMode: BackupCollisionMode };
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ServerBackupService.restoreBackup(backup, collisionMode, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to restore backup');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ result: result.value }, 'Server backup restored');
    res.json({ success: true, data: result.value });
  }
}
