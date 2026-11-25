import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { messageSearchQuerySchema, messageExportQuerySchema, idSchema } from '@galvanigraph/core-models';
import { MessageController } from '../controllers/message.controller.js';
import { MessageExportController } from '../controllers/message-export.controller.js';
import { requirePermission, scopeToChannel } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const channelIdParamsSchema = z.object({
  id: idSchema,
});

const messageParamsSchema = z.object({
  id: idSchema,
  msgId: z.coerce.number().int().positive(),
});

const router: IRouter = Router();
// Every route here that names a channel checks its permission on that channel (D-310).
scopeToChannel(router);

router.get(
  '/:id/messages',
  requirePermission('messages:read'),
  validate({ params: channelIdParamsSchema, query: messageSearchQuerySchema }),
  MessageController.search
);

// Declared before `/:id/messages/:msgId` so the literal `export` segment is
// not captured as a message id.
router.get(
  '/:id/messages/export',
  requirePermission('messages:read'),
  validate({ params: channelIdParamsSchema, query: messageExportQuerySchema }),
  MessageExportController.exportMessages
);

router.get(
  '/:id/messages/:msgId',
  requirePermission('messages:read'),
  validate({ params: messageParamsSchema }),
  MessageController.getDetail
);

router.delete(
  '/:id/messages/:msgId',
  requirePermission('messages:delete'),
  validate({ params: messageParamsSchema }),
  MessageController.delete
);

export default router;
