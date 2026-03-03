// ===========================================
// User Preference Routes
// ===========================================
// Mounted under /users/me/preferences.

import { Router, type IRouter } from 'express';
import {
  preferenceKeyParamSchema,
  upsertPreferenceSchema,
  bulkUpsertPreferencesSchema,
} from '@mirthless/core-models';
import { UserPreferenceController } from '../controllers/user-preference.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.use(authenticate);

router.get(
  '/',
  UserPreferenceController.list,
);

router.put(
  '/',
  validate({ body: upsertPreferenceSchema }),
  UserPreferenceController.upsert,
);

router.put(
  '/bulk',
  validate({ body: bulkUpsertPreferencesSchema }),
  UserPreferenceController.bulkUpsert,
);

router.get(
  '/:key',
  validate({ params: preferenceKeyParamSchema }),
  UserPreferenceController.getByKey,
);

router.delete(
  '/:key',
  validate({ params: preferenceKeyParamSchema }),
  UserPreferenceController.delete,
);

export default router;
