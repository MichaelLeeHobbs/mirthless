// ===========================================
// Audit Routes
// ===========================================
// The protected audit log (D-312): sign-ins, refusals, purges and, as later
// slices add them, PHI reads and grant changes. Readable only with audit:read.

import { Router, type IRouter } from 'express';
import { auditListQuerySchema, auditIdParamSchema } from '@galvanigraph/core-models';
import { AuditController } from '../controllers/audit.controller.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.get(
  '/',
  requirePermission('audit:read'),
  validate({ query: auditListQuerySchema }),
  AuditController.list,
);

router.get(
  '/:id',
  requirePermission('audit:read'),
  validate({ params: auditIdParamSchema }),
  AuditController.getById,
);

export default router;
