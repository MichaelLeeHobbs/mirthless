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
} from '@mirthless/core-models';
import { ChannelController } from '../controllers/channel.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const uuidParamsSchema = z.object({
  id: z.string().uuid(),
});

const router: IRouter = Router();

// All channel routes require authentication
router.use(authenticate);

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

router.patch(
  '/:id/enabled',
  requirePermission('channels:write'),
  validate({ params: uuidParamsSchema, body: patchChannelEnabledSchema }),
  ChannelController.setEnabled
);

export default router;
