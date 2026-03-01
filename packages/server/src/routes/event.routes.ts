// ===========================================
// Event Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  eventListQuerySchema,
  eventIdParamSchema,
  purgeEventsSchema,
} from '@mirthless/core-models';
import { EventController } from '../controllers/event.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

// All event routes require authentication
router.use(authenticate);

router.get(
  '/',
  requirePermission('events:read'),
  validate({ query: eventListQuerySchema }),
  EventController.list,
);

router.get(
  '/:id',
  requirePermission('events:read'),
  validate({ params: eventIdParamSchema }),
  EventController.getById,
);

router.delete(
  '/',
  requirePermission('settings:write'),
  validate({ query: purgeEventsSchema }),
  EventController.purge,
);

export default router;
