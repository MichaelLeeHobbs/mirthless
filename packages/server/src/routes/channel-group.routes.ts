// ===========================================
// Channel Group Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  createChannelGroupSchema,
  updateChannelGroupSchema,
  channelGroupUuidParamSchema,
} from '@galvaniflow/core-models';
import { ChannelGroupController } from '../controllers/channel-group.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('channels:read'),
  ChannelGroupController.listGroups,
);

// Static route before /:id
router.get(
  '/memberships',
  requirePermission('channels:read'),
  ChannelGroupController.listMemberships,
);

router.get(
  '/:id',
  requirePermission('channels:read'),
  validate({ params: channelGroupUuidParamSchema }),
  ChannelGroupController.getById,
);

router.post(
  '/',
  requirePermission('channels:write'),
  validate({ body: createChannelGroupSchema }),
  ChannelGroupController.create,
);

router.put(
  '/:id',
  requirePermission('channels:write'),
  validate({ params: channelGroupUuidParamSchema, body: updateChannelGroupSchema }),
  ChannelGroupController.update,
);

router.delete(
  '/:id',
  requirePermission('channels:write'),
  validate({ params: channelGroupUuidParamSchema }),
  ChannelGroupController.delete,
);

// A channel's memberships change through PUT /channels/:id/groups, in one
// transaction (#223).

export default router;
