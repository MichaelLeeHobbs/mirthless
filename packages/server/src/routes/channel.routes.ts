// ===========================================
// Channel Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import {
  createChannelSchema,
  updateChannelSchema,
  channelListQuerySchema,
  patchChannelEnabledSchema,
  setChannelGroupsSchema,
  channelAccessQuerySchema,
} from '@galvanigraph/core-models';
import { ChannelController } from '../controllers/channel.controller.js';
import { ChannelGroupController } from '../controllers/channel-group.controller.js';
import { requirePermission, scopeToChannel } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const uuidParamsSchema = z.object({
  id: z.string().uuid(),
});

const router: IRouter = Router();
// Every route here that names a channel checks its permission on that channel (D-310).
scopeToChannel(router);

router.get(
  '/',
  requirePermission('channels:read'),
  validate({ query: channelListQuerySchema }),
  ChannelController.list
);

router.post(
  '/',
  requirePermission('channels:write'),
  validate({ body: createChannelSchema }),
  ChannelController.create
);

router.get(
  '/:id',
  requirePermission('channels:read'),
  validate({ params: uuidParamsSchema }),
  ChannelController.getById
);

router.put(
  '/:id',
  requirePermission('channels:write'),
  validate({ params: uuidParamsSchema, body: updateChannelSchema }),
  ChannelController.update
);

router.delete(
  '/:id',
  requirePermission('channels:delete'),
  validate({ params: uuidParamsSchema }),
  ChannelController.delete
);

// Whether an enabled channel comes back at a restart is deploy control (#225).
router.patch(
  '/:id/enabled',
  requirePermission('channels:deploy'),
  validate({ params: uuidParamsSchema, body: patchChannelEnabledSchema }),
  ChannelController.setEnabled
);

// Who can access the channel, now or as of a past time (rebuilt from the audit
// log): people and how they hold access, so users:read (D-310).
router.get(
  '/:id/access',
  requirePermission('users:read'),
  validate({ params: uuidParamsSchema, query: channelAccessQuerySchema }),
  ChannelController.access
);

// Replaces the channel's group memberships in one transaction (#223).
router.put(
  '/:id/groups',
  requirePermission('channels:write'),
  validate({ params: uuidParamsSchema, body: setChannelGroupsSchema }),
  ChannelGroupController.setChannelGroups
);

router.post(
  '/:id/clone',
  requirePermission('channels:write'),
  validate({
    params: uuidParamsSchema,
    body: z.object({ name: z.string().min(1).max(255), groupId: z.string().uuid().optional() }),
  }),
  ChannelController.clone
);

export default router;
