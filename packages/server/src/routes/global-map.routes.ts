// ===========================================
// Global Map Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  globalMapKeyParamSchema,
  upsertGlobalMapEntrySchema,
} from '@mirthless/core-models';
import { GlobalMapController } from '../controllers/global-map.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('global_map:read'),
  GlobalMapController.list,
);

// DELETE / (clear all) must be before DELETE /:key
router.delete(
  '/',
  requirePermission('global_map:write'),
  GlobalMapController.clear,
);

router.get(
  '/:key',
  requirePermission('global_map:read'),
  validate({ params: globalMapKeyParamSchema }),
  GlobalMapController.getByKey,
);

router.put(
  '/:key',
  requirePermission('global_map:write'),
  validate({ params: globalMapKeyParamSchema, body: upsertGlobalMapEntrySchema }),
  GlobalMapController.upsert,
);

router.delete(
  '/:key',
  requirePermission('global_map:write'),
  validate({ params: globalMapKeyParamSchema }),
  GlobalMapController.delete,
);

export default router;
