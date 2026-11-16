// ===========================================
// Script Validation Routes
// ===========================================
// POST /validate — check JavaScript/TypeScript syntax
// POST /test-run — run a script against a sample message, with no side effects

import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { scriptTestRunSchema } from '@galvaniflow/core-models';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { ScriptValidationController } from '../controllers/script-validation.controller.js';
import { testRunRateLimiter } from '../middleware/rate-limit.middleware.js';

const validateScriptSchema = z.object({
  script: z.string(),
  language: z.enum(['javascript', 'typescript']).default('javascript'),
});

const router: IRouter = Router();

router.post(
  '/validate',
  requirePermission('channels:read'),
  validate({ body: validateScriptSchema }),
  ScriptValidationController.validate,
);

// Runs user code on the server on demand. Writing channel scripts is enough
// (developers too, Michael's call, D-286): the run is in a worker with resource
// limits, one at a time, rate-limited, audited, and its bridges are dry.
router.post(
  '/test-run',
  requirePermission('channels:write'),
  testRunRateLimiter,
  validate({ body: scriptTestRunSchema }),
  ScriptValidationController.testRun,
);

export default router;
