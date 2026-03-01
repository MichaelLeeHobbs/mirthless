// ===========================================
// Script Validation Routes
// ===========================================
// POST /validate — check JavaScript/TypeScript syntax

import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { ScriptValidationController } from '../controllers/script-validation.controller.js';

const validateScriptSchema = z.object({
  script: z.string(),
  language: z.enum(['javascript', 'typescript']).default('javascript'),
});

const router: IRouter = Router();

router.use(authenticate);

router.post(
  '/validate',
  requirePermission('channels:read'),
  validate({ body: validateScriptSchema }),
  ScriptValidationController.validate,
);

export default router;
