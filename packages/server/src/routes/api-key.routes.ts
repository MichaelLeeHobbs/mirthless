// ===========================================
// API Key Routes
// ===========================================
// Issue and manage API keys (D-313, RBAC plan section 7). Reading needs
// api_keys:read; every change needs api_keys:manage, and issuing or enabling
// a key also needs its grants within the caller's own (api-key.service.ts).

import { Router, type IRouter } from 'express';
import { z } from 'zod/v4';
import { createApiKeySchema, replaceApiKeySchema, revokeApiKeySchema, setApiKeyEnabledSchema } from '@galvanigraph/core-models';
import { ApiKeyController } from '../controllers/api-key.controller.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const idParams = z.object({ id: z.string().uuid() });

const router: IRouter = Router();

router.get('/', requirePermission('api_keys:read'), ApiKeyController.list);

router.get('/:id', requirePermission('api_keys:read'), validate({ params: idParams }), ApiKeyController.get);

router.post('/', requirePermission('api_keys:manage'), validate({ body: createApiKeySchema }), ApiKeyController.issue);

router.patch('/:id/enabled', requirePermission('api_keys:manage'), validate({ params: idParams, body: setApiKeyEnabledSchema }), ApiKeyController.setEnabled);

router.post('/:id/revoke', requirePermission('api_keys:manage'), validate({ params: idParams, body: revokeApiKeySchema }), ApiKeyController.revoke);

// A new secret, and the caller becomes the issuer, within what they hold (D-313).
router.post('/:id/replace', requirePermission('api_keys:manage'), validate({ params: idParams, body: replaceApiKeySchema }), ApiKeyController.replace);

export default router;
