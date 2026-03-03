// ===========================================
// Channel Revision Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { channelRevisionParamsSchema } from '@mirthless/core-models';
import { ChannelRevisionController } from '../controllers/channel-revision.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const uuidParam = z.object({ id: z.string().uuid() });

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/:id/revisions',
  requirePermission('channels:read'),
  validate({ params: uuidParam }),
  ChannelRevisionController.list,
);

router.get(
  '/:id/revisions/:rev',
  requirePermission('channels:read'),
  validate({ params: channelRevisionParamsSchema }),
  ChannelRevisionController.getByRevision,
);

export default router;
