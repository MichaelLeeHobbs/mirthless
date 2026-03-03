// ===========================================
// Message Generator Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { generateMessagesInputSchema } from '@mirthless/core-models';
import { MessageGeneratorController } from '../controllers/message-generator.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.post(
  '/',
  requirePermission('channels:read'),
  validate({ body: generateMessagesInputSchema }),
  MessageGeneratorController.generate,
);

export default router;
