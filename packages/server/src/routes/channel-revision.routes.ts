// ===========================================
// Channel Revision Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { channelRevisionParamsSchema } from '@galvanigraph/core-models';
import { ChannelRevisionController } from '../controllers/channel-revision.controller.js';
import { requirePermission, scopeToChannel } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const uuidParam = z.object({ id: z.string().uuid() });

const router: IRouter = Router();
// Every route here that names a channel checks its permission on that channel (D-310).
scopeToChannel(router);

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
