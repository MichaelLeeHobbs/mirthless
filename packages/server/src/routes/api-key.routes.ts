// Issuing or enabling a key also needs its grants within the caller's own,
// checked in api-key.service.ts (D-313).

import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { createApiKeySchema, replaceApiKeySchema, revokeApiKeySchema, setApiKeyEnabledSchema, idSchema } from '@galvanigraph/core-models';
import { ApiKeyController } from '../controllers/api-key.controller.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const idParams = z.object({ id: idSchema });

const router: IRouter = Router();

router.get('/', requirePermission('api_keys:read'), ApiKeyController.list);

router.get('/:id', requirePermission('api_keys:read'), validate({ params: idParams }), ApiKeyController.get);

router.post('/', requirePermission('api_keys:manage'), validate({ body: createApiKeySchema }), ApiKeyController.issue);

router.patch('/:id/enabled', requirePermission('api_keys:manage'), validate({ params: idParams, body: setApiKeyEnabledSchema }), ApiKeyController.setEnabled);

router.post('/:id/revoke', requirePermission('api_keys:manage'), validate({ params: idParams, body: revokeApiKeySchema }), ApiKeyController.revoke);

// A new secret, and the caller becomes the issuer, within what they hold (D-313).
router.post('/:id/replace', requirePermission('api_keys:manage'), validate({ params: idParams, body: replaceApiKeySchema }), ApiKeyController.replace);

export default router;
