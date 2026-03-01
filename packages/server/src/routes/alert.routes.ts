// ===========================================
// Alert Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  createAlertSchema,
  updateAlertSchema,
  alertListQuerySchema,
  alertUuidParamSchema,
  patchAlertEnabledSchema,
} from '@mirthless/core-models';
import { AlertController } from '../controllers/alert.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

// All alert routes require authentication
router.use(authenticate);

router.get(
  '/',
  requirePermission('alerts:read'),
  validate({ query: alertListQuerySchema }),
  AlertController.list,
);

router.get(
  '/:id',
  requirePermission('alerts:read'),
  validate({ params: alertUuidParamSchema }),
  AlertController.getById,
);

router.post(
  '/',
  requirePermission('alerts:write'),
  validate({ body: createAlertSchema }),
  AlertController.create,
);

router.put(
  '/:id',
  requirePermission('alerts:write'),
  validate({ params: alertUuidParamSchema, body: updateAlertSchema }),
  AlertController.update,
);

router.delete(
  '/:id',
  requirePermission('alerts:delete'),
  validate({ params: alertUuidParamSchema }),
  AlertController.delete,
);

router.patch(
  '/:id/enabled',
  requirePermission('alerts:write'),
  validate({ params: alertUuidParamSchema, body: patchAlertEnabledSchema }),
  AlertController.setEnabled,
);

export default router;
