// ===========================================
// Cross-Channel Search Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { crossChannelSearchQuerySchema } from '@mirthless/core-models';
import { CrossChannelSearchController } from '../controllers/cross-channel-search.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('channels:read'),
  validate({ query: crossChannelSearchQuerySchema }),
  CrossChannelSearchController.search,
);

export default router;
