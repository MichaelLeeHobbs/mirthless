// ===========================================
// Connection Test Routes
// ===========================================
// POST / — test connector connectivity

import { Router, type IRouter } from 'express';
import { connectionTestSchema } from '@mirthless/core-models';
import { ConnectionTestController } from '../controllers/connection-test.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.post(
  '/',
  requirePermission('channels:deploy'),
  validate({ body: connectionTestSchema }),
  ConnectionTestController.test,
);

export default router;
