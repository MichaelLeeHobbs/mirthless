// ===========================================
// System Info Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { SystemInfoController } from '../controllers/system-info.controller.js';
import { requirePermission } from '../middleware/permission.middleware.js';

const router: IRouter = Router();

router.get(
  '/',
  requirePermission('system:info'),
  SystemInfoController.getInfo,
);

export default router;
