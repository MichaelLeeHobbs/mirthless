import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { scriptTestRunSchema } from '@galvanigraph/core-models';
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

// Runs user code on the server, yet channels:write is enough (D-286): the run is
// in a resource-limited worker, one at a time, rate-limited, audited, with dry bridges.
router.post(
  '/test-run',
  requirePermission('channels:write'),
  testRunRateLimiter,
  validate({ body: scriptTestRunSchema }),
  ScriptValidationController.testRun,
);

export default router;
