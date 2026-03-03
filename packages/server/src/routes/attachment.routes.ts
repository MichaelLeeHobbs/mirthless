// ===========================================
// Attachment Routes
// ===========================================
// Mounted under /channels (before greedy /:id).

import { Router, type IRouter } from 'express';
import {
  attachmentListParamsSchema,
  attachmentGetParamsSchema,
} from '@mirthless/core-models';
import { AttachmentController } from '../controllers/attachment.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/:id/messages/:msgId/attachments',
  requirePermission('channels:read'),
  validate({ params: attachmentListParamsSchema }),
  AttachmentController.list,
);

router.get(
  '/:id/messages/:msgId/attachments/:attachmentId',
  requirePermission('channels:read'),
  validate({ params: attachmentGetParamsSchema }),
  AttachmentController.getById,
);

export default router;
