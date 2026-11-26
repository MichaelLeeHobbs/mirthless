import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { idSchema, purgeDeletedChannelSchema } from '@galvanigraph/core-models';
import { DataPrunerController } from '../controllers/data-pruner.controller.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const channelIdParamsSchema = z.object({
  channelId: idSchema,
});

const pruneChannelBodySchema = z.object({
  maxAgeDays: z.number().int().min(1),
});

const router: IRouter = Router();

// Statistics must come before /:channelId to avoid route conflict
router.get(
  '/statistics',
  requirePermission('settings:read'),
  DataPrunerController.getStatistics,
);

router.get(
  '/deleted-channels',
  requirePermission('settings:read'),
  DataPrunerController.listDeletedChannels,
);

router.post(
  '/deleted-channels/:channelId',
  requirePermission('settings:write'),
  validate({ params: channelIdParamsSchema, body: purgeDeletedChannelSchema }),
  DataPrunerController.purgeDeletedChannel,
);

router.post(
  '/',
  requirePermission('settings:write'),
  DataPrunerController.pruneAll,
);

router.post(
  '/:channelId',
  requirePermission('settings:write'),
  validate({ params: channelIdParamsSchema, body: pruneChannelBodySchema }),
  DataPrunerController.pruneChannel,
);

export default router;
