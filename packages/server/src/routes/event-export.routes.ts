// ===========================================
// Event Export Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { eventExportQuerySchema } from '@galvanigraph/core-models';
import { EventExportController } from '../controllers/event-export.controller.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.get(
  '/',
  requirePermission('events:read'),
  validate({ query: eventExportQuerySchema }),
  EventExportController.exportEvents,
);

export default router;
