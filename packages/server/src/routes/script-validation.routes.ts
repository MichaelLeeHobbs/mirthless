// ===========================================
// Script Validation Routes
// ===========================================
// POST /validate — check JavaScript/TypeScript syntax
// POST /test-run — run a script against a sample message, with no side effects

import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { scriptTestRunSchema } from '@galvaniflow/core-models';
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

// Runs user code on the server (sandboxed, no side effects), so it needs the
// permission to write channel scripts, not just read them.
router.post(
  '/test-run',
  requirePermission('channels:write'),
  validate({ body: scriptTestRunSchema }),
  ScriptValidationController.testRun,
);

export default router;
