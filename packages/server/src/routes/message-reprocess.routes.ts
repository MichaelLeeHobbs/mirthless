// ===========================================
// Message Reprocess Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { reprocessParamsSchema, bulkDeleteInputSchema, bulkDeleteParamsSchema } from '@mirthless/core-models';
import { MessageReprocessController } from '../controllers/message-reprocess.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.post(
  '/:id/messages/:msgId/reprocess',
  requirePermission('channels:deploy'),
  validate({ params: reprocessParamsSchema }),
  MessageReprocessController.reprocess,
);

router.delete(
  '/:id/messages/bulk',
  requirePermission('channels:delete'),
  validate({ params: bulkDeleteParamsSchema, body: bulkDeleteInputSchema }),
  MessageReprocessController.bulkDelete,
);

export default router;
