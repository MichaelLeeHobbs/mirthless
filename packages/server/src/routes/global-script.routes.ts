// ===========================================
// Global Script Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { updateGlobalScriptsSchema } from '@mirthless/core-models';
import { GlobalScriptController } from '../controllers/global-script.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

// All global script routes require authentication
router.use(authenticate);

router.get(
  '/',
  requirePermission('global_scripts:read'),
  GlobalScriptController.getAll,
);

router.put(
  '/',
  requirePermission('global_scripts:write'),
  validate({ body: updateGlobalScriptsSchema }),
  GlobalScriptController.update,
);

export default router;
