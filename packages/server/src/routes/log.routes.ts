// ===========================================
// Log Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { LogController } from '../controllers/log.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const logQuerySchema = z.object({
  level: z.coerce.number().int().min(10).max(70).optional(),
  search: z.string().max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('system:info'),
  validate({ query: logQuerySchema }),
  LogController.getEntries,
);

export default router;
