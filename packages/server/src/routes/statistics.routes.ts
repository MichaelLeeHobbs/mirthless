// ===========================================
// Statistics Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { StatisticsController } from '../controllers/statistics.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const uuidParamsSchema = z.object({
  id: z.string().uuid(),
});

const router: IRouter = Router();

router.use(authenticate);

// All channels summary (must come before /:id to avoid route conflict)
router.get(
  '/statistics',
  requirePermission('channels:read'),
  StatisticsController.getAllStats
);

// Per-channel statistics
router.get(
  '/:id/statistics',
  requirePermission('channels:read'),
  validate({ params: uuidParamsSchema }),
  StatisticsController.getChannelStats
);

// Reset per-channel statistics
router.post(
  '/:id/statistics/reset',
  requirePermission('channels:deploy'),
  validate({ params: uuidParamsSchema }),
  StatisticsController.resetStats
);

export default router;
