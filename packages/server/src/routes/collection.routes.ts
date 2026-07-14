// ===========================================
// Collection Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  createCollectionSchema,
  updateCollectionSchema,
  collectionUuidParamSchema,
} from '@mirthless/core-models';
import { CollectionController } from '../controllers/collection.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('collections:read'),
  CollectionController.list,
);

router.get(
  '/:id',
  requirePermission('collections:read'),
  validate({ params: collectionUuidParamSchema }),
  CollectionController.getById,
);

router.get(
  '/:id/records',
  requirePermission('collections:read'),
  validate({ params: collectionUuidParamSchema }),
  CollectionController.listRecords,
);

router.post(
  '/',
  requirePermission('collections:write'),
  validate({ body: createCollectionSchema }),
  CollectionController.create,
);

router.put(
  '/:id',
  requirePermission('collections:write'),
  validate({ params: collectionUuidParamSchema, body: updateCollectionSchema }),
  CollectionController.update,
);

router.delete(
  '/:id',
  requirePermission('collections:delete'),
  validate({ params: collectionUuidParamSchema }),
  CollectionController.delete,
);

export default router;
