// ===========================================
// Log Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { LogController } from '../controllers/log.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('system:info'),
  LogController.getEntries,
);

export default router;
