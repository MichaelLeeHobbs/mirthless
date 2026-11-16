// ===========================================
// Global Script Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { updateGlobalScriptsSchema } from '@galvanigraph/core-models';
import { GlobalScriptController } from '../controllers/global-script.controller.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

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
