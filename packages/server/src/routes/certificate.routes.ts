// ===========================================
// Certificate Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  createCertificateSchema,
  updateCertificateSchema,
  certificateUuidParamSchema,
  certificateListQuerySchema,
} from '@mirthless/core-models';
import { CertificateController } from '../controllers/certificate.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('settings:read'),
  validate({ query: certificateListQuerySchema }),
  CertificateController.list,
);

router.get(
  '/:id',
  requirePermission('settings:read'),
  validate({ params: certificateUuidParamSchema }),
  CertificateController.getById,
);

router.post(
  '/',
  requirePermission('settings:write'),
  validate({ body: createCertificateSchema }),
  CertificateController.create,
);

router.put(
  '/:id',
  requirePermission('settings:write'),
  validate({ params: certificateUuidParamSchema, body: updateCertificateSchema }),
  CertificateController.update,
);

router.delete(
  '/:id',
  requirePermission('settings:write'),
  validate({ params: certificateUuidParamSchema }),
  CertificateController.delete,
);

export default router;
