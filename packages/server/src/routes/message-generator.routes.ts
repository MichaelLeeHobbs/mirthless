import { Router, type IRouter } from 'express';
import { generateMessagesInputSchema } from '@galvanigraph/core-models';
import { MessageGeneratorController } from '../controllers/message-generator.controller.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.post(
  '/',
  requirePermission('channels:read'),
  validate({ body: generateMessagesInputSchema }),
  MessageGeneratorController.generate,
);

export default router;
