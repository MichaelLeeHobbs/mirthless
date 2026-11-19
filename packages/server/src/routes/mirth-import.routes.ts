import { Router, type IRouter } from 'express';
import { mirthImportSchema } from '@galvanigraph/core-models';
import { MirthImportController } from '../controllers/mirth-import.controller.js';
import { largeJsonBody } from '../middleware/body-limit.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

// Large bodies are parsed here, after authentication, never before it.
router.use(largeJsonBody);

router.post(
  '/',
  requirePermission('channels:write'),
  validate({ body: mirthImportSchema }),
  MirthImportController.importFromXml,
);

router.post(
  '/preview',
  requirePermission('channels:read'),
  validate({ body: mirthImportSchema }),
  MirthImportController.preview,
);

export default router;
