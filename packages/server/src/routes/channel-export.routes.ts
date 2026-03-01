// ===========================================
// Channel Export/Import Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { channelImportSchema } from '@mirthless/core-models';
import { ChannelExportController } from '../controllers/channel-export.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const uuidParamsSchema = z.object({
  id: z.string().uuid(),
});

const router: IRouter = Router();

// All routes require authentication
router.use(authenticate);

// GET /channels/export — Export all channels
router.get(
  '/export',
  requirePermission('channels:read'),
  ChannelExportController.exportAll
);

// GET /channels/:id/export — Export a single channel
router.get(
  '/:id/export',
  requirePermission('channels:read'),
  validate({ params: uuidParamsSchema }),
  ChannelExportController.exportChannel
);

// POST /channels/import — Import channels from JSON
router.post(
  '/import',
  requirePermission('channels:write'),
  validate({ body: channelImportSchema }),
  ChannelExportController.importChannels
);

export default router;
