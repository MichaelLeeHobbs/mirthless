// ===========================================
// Message Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { messageSearchQuerySchema } from '@mirthless/core-models';
import { MessageController } from '../controllers/message.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const channelIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const messageParamsSchema = z.object({
  id: z.string().uuid(),
  msgId: z.coerce.number().int().positive(),
});

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/:id/messages',
  requirePermission('channels:read'),
  validate({ params: channelIdParamsSchema, query: messageSearchQuerySchema }),
  MessageController.search
);

router.get(
  '/:id/messages/:msgId',
  requirePermission('channels:read'),
  validate({ params: messageParamsSchema }),
  MessageController.getDetail
);

router.delete(
  '/:id/messages/:msgId',
  requirePermission('channels:delete'),
  validate({ params: messageParamsSchema }),
  MessageController.delete
);

export default router;
