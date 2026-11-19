import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { channelImportSchema } from '@galvanigraph/core-models';
import { ChannelExportController } from '../controllers/channel-export.controller.js';
import { largeJsonBody } from '../middleware/body-limit.middleware.js';
import { requirePermission, scopeToChannel } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const uuidParamsSchema = z.object({
  id: z.string().uuid(),
});

const router: IRouter = Router();
// Every route here that names a channel checks its permission on that channel (D-310).
scopeToChannel(router);

// Large bodies are parsed here, after authentication, never before it.
router.use(largeJsonBody);

router.get(
  '/export',
  requirePermission('channels:read'),
  ChannelExportController.exportAll
);

router.get(
  '/:id/export',
  requirePermission('channels:read'),
  validate({ params: uuidParamsSchema }),
  ChannelExportController.exportChannel
);

router.post(
  '/import',
  requirePermission('channels:write'),
  validate({ body: channelImportSchema }),
  ChannelExportController.importChannels
);

export default router;
