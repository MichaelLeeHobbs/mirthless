// ===========================================
// Pruner Scheduler Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { PrunerSchedulerController } from '../controllers/pruner-scheduler.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const updateScheduleSchema = z.object({
  enabled: z.boolean(),
  cronExpression: z.string().min(1),
});

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/schedule',
  requirePermission('settings:read'),
  PrunerSchedulerController.getStatus,
);

router.put(
  '/schedule',
  requirePermission('settings:write'),
  validate({ body: updateScheduleSchema }),
  PrunerSchedulerController.updateSchedule,
);

export default router;
