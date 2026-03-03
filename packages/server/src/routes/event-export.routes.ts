// ===========================================
// Event Export Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { eventExportQuerySchema } from '@mirthless/core-models';
import { EventExportController } from '../controllers/event-export.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

// All export routes require authentication
router.use(authenticate);

router.get(
  '/',
  requirePermission('events:read'),
  validate({ query: eventExportQuerySchema }),
  EventExportController.exportEvents,
);

export default router;
