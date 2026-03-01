// ===========================================
// Settings Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  settingsListQuerySchema,
  settingKeyParamSchema,
  upsertSettingSchema,
  bulkUpsertSettingsSchema,
} from '@mirthless/core-models';
import { SettingsController } from '../controllers/settings.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

// All settings routes require authentication
router.use(authenticate);

router.get(
  '/',
  requirePermission('settings:read'),
  validate({ query: settingsListQuerySchema }),
  SettingsController.list,
);

// Bulk upsert must come before /:key to avoid route conflict
router.put(
  '/bulk',
  requirePermission('settings:write'),
  validate({ body: bulkUpsertSettingsSchema }),
  SettingsController.bulkUpsert,
);

router.get(
  '/:key',
  requirePermission('settings:read'),
  validate({ params: settingKeyParamSchema }),
  SettingsController.getByKey,
);

router.put(
  '/:key',
  requirePermission('settings:write'),
  validate({ params: settingKeyParamSchema, body: upsertSettingSchema }),
  SettingsController.upsert,
);

router.delete(
  '/:key',
  requirePermission('settings:write'),
  validate({ params: settingKeyParamSchema }),
  SettingsController.delete,
);

export default router;
