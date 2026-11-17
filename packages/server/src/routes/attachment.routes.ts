// ===========================================
// Attachment Routes
// ===========================================
// Mounted under /channels (before greedy /:id).

import { Router, type IRouter } from 'express';
import {
  attachmentListParamsSchema,
  attachmentGetParamsSchema,
} from '@galvanigraph/core-models';
import { AttachmentController } from '../controllers/attachment.controller.js';
import { requirePermission, scopeToChannel } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();
// Every route here that names a channel checks its permission on that channel (D-310).
scopeToChannel(router);

router.get(
  '/:id/messages/:msgId/attachments',
  requirePermission('messages:read'),
  validate({ params: attachmentListParamsSchema }),
  AttachmentController.list,
);

router.get(
  '/:id/messages/:msgId/attachments/:attachmentId',
  requirePermission('messages:read'),
  validate({ params: attachmentGetParamsSchema }),
  AttachmentController.getById,
);

export default router;
