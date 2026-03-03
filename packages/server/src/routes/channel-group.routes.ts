// ===========================================
// Channel Group Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  createChannelGroupSchema,
  updateChannelGroupSchema,
  addChannelGroupMemberSchema,
  channelGroupUuidParamSchema,
  channelGroupMemberParamSchema,
} from '@mirthless/core-models';
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

router.post(
  '/:id/members',
  requirePermission('channels:write'),
  validate({ params: channelGroupUuidParamSchema, body: addChannelGroupMemberSchema }),
  ChannelGroupController.addMember,
);

router.delete(
  '/:id/members/:channelId',
  requirePermission('channels:write'),
  validate({ params: channelGroupMemberParamSchema }),
  ChannelGroupController.removeMember,
);

export default router;
