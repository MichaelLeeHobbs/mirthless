// ===========================================
// Tag Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  createTagSchema,
  updateTagSchema,
  assignTagSchema,
  tagUuidParamSchema,
  tagChannelParamSchema,
} from '@mirthless/core-models';
import { TagController } from '../controllers/tag.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('settings:read'),
  TagController.listTags,
);

// Static route before /:id
router.get(
  '/assignments',
  requirePermission('channels:read'),
  TagController.listAssignments,
);

router.post(
  '/',
  requirePermission('settings:write'),
  validate({ body: createTagSchema }),
  TagController.create,
);

router.put(
  '/:id',
  requirePermission('settings:write'),
  validate({ params: tagUuidParamSchema, body: updateTagSchema }),
  TagController.update,
);

router.delete(
  '/:id',
  requirePermission('settings:write'),
  validate({ params: tagUuidParamSchema }),
  TagController.delete,
);

router.post(
  '/:id/channels',
  requirePermission('settings:write'),
  validate({ params: tagUuidParamSchema, body: assignTagSchema }),
  TagController.assign,
);

router.delete(
  '/:id/channels/:channelId',
  requirePermission('settings:write'),
  validate({ params: tagChannelParamSchema }),
  TagController.unassign,
);

export default router;
