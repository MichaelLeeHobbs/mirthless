import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { idSchema } from '@galvanigraph/core-models';
import { StatisticsController } from '../controllers/statistics.controller.js';
import { requirePermission, scopeToChannel } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const uuidParamsSchema = z.object({
  id: idSchema,
});

const router: IRouter = Router();
// Every route here that names a channel checks its permission on that channel (D-310).
scopeToChannel(router);

router.get(
  '/statistics',
  requirePermission('channels:read'),
  StatisticsController.getAllStats
);

router.get(
  '/:id/statistics',
  requirePermission('channels:read'),
  validate({ params: uuidParamsSchema }),
  StatisticsController.getChannelStats
);

router.post(
  '/:id/statistics/reset',
  requirePermission('channels:deploy'),
  validate({ params: uuidParamsSchema }),
  StatisticsController.resetStats
);

export default router;
