// ===========================================
// Configuration Map Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  configMapParamSchema,
  configMapQuerySchema,
  upsertConfigMapEntrySchema,
  bulkUpsertConfigMapSchema,
} from '@mirthless/core-models';
import { ConfigMapController } from '../controllers/config-map.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('config_map:read'),
  validate({ query: configMapQuerySchema }),
  ConfigMapController.list,
);

// Bulk upsert must be before /:category/:name routes
router.put(
  '/bulk',
  requirePermission('config_map:write'),
  validate({ body: bulkUpsertConfigMapSchema }),
  ConfigMapController.bulkUpsert,
);

router.get(
  '/:category/:name',
  requirePermission('config_map:read'),
  validate({ params: configMapParamSchema }),
  ConfigMapController.getByKey,
);

router.put(
  '/:category/:name',
  requirePermission('config_map:write'),
  validate({ params: configMapParamSchema, body: upsertConfigMapEntrySchema }),
  ConfigMapController.upsert,
);

router.delete(
  '/:category/:name',
  requirePermission('config_map:write'),
  validate({ params: configMapParamSchema }),
  ConfigMapController.delete,
);

export default router;
