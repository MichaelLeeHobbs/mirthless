// ===========================================
// Mirth Connect XML Import Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { mirthImportSchema } from '@mirthless/core-models';
import { MirthImportController } from '../controllers/mirth-import.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

// All routes require authentication
router.use(authenticate);

// POST /channels/import/mirth — Import from Mirth Connect XML
router.post(
  '/',
  requirePermission('channels:write'),
  validate({ body: mirthImportSchema }),
  MirthImportController.importFromXml,
);

// POST /channels/import/mirth/preview — Preview conversion (dry run)
router.post(
  '/preview',
  requirePermission('channels:read'),
  validate({ body: mirthImportSchema }),
  MirthImportController.preview,
);

export default router;
