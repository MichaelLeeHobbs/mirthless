// ===========================================
// Data Pruner Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { DataPrunerController } from '../controllers/data-pruner.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const channelIdParamsSchema = z.object({
  channelId: z.string().uuid(),
});

const pruneChannelBodySchema = z.object({
  maxAgeDays: z.number().int().min(1),
});

const router: IRouter = Router();

router.use(authenticate);

// Statistics must come before /:channelId to avoid route conflict
router.get(
  '/statistics',
  requirePermission('settings:read'),
  DataPrunerController.getStatistics,
);

// Prune all channels
router.post(
  '/',
  requirePermission('settings:write'),
  DataPrunerController.pruneAll,
);

// Prune a specific channel
router.post(
  '/:channelId',
  requirePermission('settings:write'),
  validate({ params: channelIdParamsSchema, body: pruneChannelBodySchema }),
  DataPrunerController.pruneChannel,
);

export default router;
