// ===========================================
// Deployment Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { DeploymentController } from '../controllers/deployment.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const uuidParamsSchema = z.object({
  id: z.string().uuid(),
});

const router: IRouter = Router();

// All deployment routes require authentication + deployer permission
router.use(authenticate);

// Channel-specific actions
router.post('/:id/deploy', requirePermission('channels:deploy'), validate({ params: uuidParamsSchema }), DeploymentController.deploy);
router.post('/:id/undeploy', requirePermission('channels:deploy'), validate({ params: uuidParamsSchema }), DeploymentController.undeploy);
router.post('/:id/start', requirePermission('channels:deploy'), validate({ params: uuidParamsSchema }), DeploymentController.start);
router.post('/:id/stop', requirePermission('channels:deploy'), validate({ params: uuidParamsSchema }), DeploymentController.stop);
router.post('/:id/halt', requirePermission('channels:deploy'), validate({ params: uuidParamsSchema }), DeploymentController.halt);
router.post('/:id/pause', requirePermission('channels:deploy'), validate({ params: uuidParamsSchema }), DeploymentController.pause);
router.post('/:id/resume', requirePermission('channels:deploy'), validate({ params: uuidParamsSchema }), DeploymentController.resume);
router.get('/:id/status', requirePermission('channels:read'), validate({ params: uuidParamsSchema }), DeploymentController.getStatus);

// All channels status
router.get('/status', requirePermission('channels:read'), DeploymentController.getAllStatuses);

export default router;
