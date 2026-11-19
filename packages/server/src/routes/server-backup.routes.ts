import { Router, type IRouter } from 'express';
import { backupExportQuerySchema, serverRestoreInputSchema } from '@galvanigraph/core-models';
import { ServerBackupController } from '../controllers/server-backup.controller.js';
import { largeJsonBody } from '../middleware/body-limit.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

// Large bodies are parsed here, after authentication, never before it.
router.use(largeJsonBody);

router.get(
  '/',
  requirePermission('system:backup'),
  validate({ query: backupExportQuerySchema }),
  ServerBackupController.exportBackup,
);

router.post(
  '/',
  requirePermission('system:restore'),
  validate({ body: serverRestoreInputSchema }),
  ServerBackupController.restoreBackup,
);

export default router;
