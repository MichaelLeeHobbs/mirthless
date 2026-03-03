// ===========================================
// Extension Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { setExtensionEnabledSchema } from '@mirthless/core-models';
import { ExtensionController } from '../controllers/extension.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const idParam = z.object({ id: z.string().min(1) });

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('settings:read'),
  ExtensionController.list,
);

router.get(
  '/:id',
  requirePermission('settings:read'),
  validate({ params: idParam }),
  ExtensionController.getById,
);

router.patch(
  '/:id/enabled',
  requirePermission('settings:write'),
  validate({ params: idParam, body: setExtensionEnabledSchema }),
  ExtensionController.setEnabled,
);

export default router;
