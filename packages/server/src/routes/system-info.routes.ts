// ===========================================
// System Info Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { SystemInfoController } from '../controllers/system-info.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('system:info'),
  SystemInfoController.getInfo,
);

export default router;
