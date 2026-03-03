// ===========================================
// Resource Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  createResourceSchema,
  updateResourceSchema,
  resourceUuidParamSchema,
} from '@mirthless/core-models';
import { ResourceController } from '../controllers/resource.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('resources:read'),
  ResourceController.list,
);

router.get(
  '/:id',
  requirePermission('resources:read'),
  validate({ params: resourceUuidParamSchema }),
  ResourceController.getById,
);

router.post(
  '/',
  requirePermission('resources:write'),
  validate({ body: createResourceSchema }),
  ResourceController.create,
);

router.put(
  '/:id',
  requirePermission('resources:write'),
  validate({ params: resourceUuidParamSchema, body: updateResourceSchema }),
  ResourceController.update,
);

router.delete(
  '/:id',
  requirePermission('resources:delete'),
  validate({ params: resourceUuidParamSchema }),
  ResourceController.delete,
);

export default router;
