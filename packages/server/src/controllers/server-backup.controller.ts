// ===========================================
// Server Backup Controller
// ===========================================
// Handles HTTP requests for server backup/restore.

import type { Request, Response } from 'express';
import type { BackupCollisionMode, BackupExportQuery, ServerBackup } from '@galvanigraph/core-models';
import { exportHeader } from '../lib/export-header.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { ServerBackupService } from '../services/server-backup.service.js';
import logger from '../lib/logger.js';

export class ServerBackupController {
  static async exportBackup(req: Request, res: Response): Promise<void> {
    const { reason } = req.query as unknown as BackupExportQuery;
    const result = await ServerBackupService.exportBackup(reason, { userId: req.user?.id ?? null, ipAddress: req.ip ?? null });

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to export backup');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    // exportInfo goes first: the recorded hash is of the file without it.
    const exportInfo = exportHeader(req, result.value.auditRecordId, reason);
    res.json({ success: true, data: { exportInfo, ...result.value.backup } });
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
