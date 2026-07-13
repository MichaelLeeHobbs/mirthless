// ===========================================
// Data Source Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  createDataSourceSchema,
  updateDataSourceSchema,
  testDataSourceSchema,
  dataSourceUuidParamSchema,
} from '@mirthless/core-models';
import { DataSourceController } from '../controllers/data-source.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('datasources:read'),
  DataSourceController.list,
);

router.post(
  '/test',
  requirePermission('datasources:write'),
  validate({ body: testDataSourceSchema }),
  DataSourceController.testConnection,
);

router.get(
  '/:id',
  requirePermission('datasources:read'),
  validate({ params: dataSourceUuidParamSchema }),
  DataSourceController.getById,
);

router.post(
  '/',
  requirePermission('datasources:write'),
  validate({ body: createDataSourceSchema }),
  DataSourceController.create,
);

router.put(
  '/:id',
  requirePermission('datasources:write'),
  validate({ params: dataSourceUuidParamSchema, body: updateDataSourceSchema }),
  DataSourceController.update,
);

router.delete(
  '/:id',
  requirePermission('datasources:delete'),
  validate({ params: dataSourceUuidParamSchema }),
  DataSourceController.delete,
);

export default router;
