// ===========================================
// Event Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  eventListQuerySchema,
  eventIdParamSchema,
  purgeEventsSchema,
} from '@galvanigraph/core-models';
import { EventController } from '../controllers/event.controller.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

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
