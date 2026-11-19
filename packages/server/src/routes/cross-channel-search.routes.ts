import { Router, type IRouter } from 'express';
import { crossChannelSearchQuerySchema } from '@galvanigraph/core-models';
import { CrossChannelSearchController } from '../controllers/cross-channel-search.controller.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.get(
  '/',
  // Lists message ids, status and times from every channel in scope (D-310).
  requirePermission('messages:read'),
  validate({ query: crossChannelSearchQuerySchema }),
  CrossChannelSearchController.search,
);

export default router;
