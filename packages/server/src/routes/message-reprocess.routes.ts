// ===========================================
// Message Reprocess Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  reprocessParamsSchema,
  bulkDeleteInputSchema,
  bulkDeleteParamsSchema,
  bulkReprocessInputSchema,
  resendParamsSchema,
} from '@mirthless/core-models';
import { MessageReprocessController } from '../controllers/message-reprocess.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

// Specific/static routes are declared before the greedy `/:msgId` patterns so
// literal segments (bulk, bulk-reprocess) are not captured as message ids.
router.post(
  '/:id/messages/bulk-reprocess',
  requirePermission('messages:reprocess'),
  validate({ params: bulkDeleteParamsSchema, body: bulkReprocessInputSchema }),
  MessageReprocessController.bulkReprocess,
);

router.delete(
  '/:id/messages/bulk',
  requirePermission('messages:delete'),
  validate({ params: bulkDeleteParamsSchema, body: bulkDeleteInputSchema }),
  MessageReprocessController.bulkDelete,
);

router.post(
  '/:id/messages/:msgId/reprocess',
  requirePermission('messages:reprocess'),
  validate({ params: reprocessParamsSchema }),
  MessageReprocessController.reprocess,
);

router.post(
  '/:id/messages/:msgId/connectors/:metaDataId/resend',
  requirePermission('messages:reprocess'),
  validate({ params: resendParamsSchema }),
  MessageReprocessController.resend,
);

export default router;
