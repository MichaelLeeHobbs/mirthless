// A clone is a create with `clonedFrom` (D-310).

import { Router, type IRouter } from 'express';
import { createRoleSchema, updateRoleSchema, roleIdParamSchema } from '@galvanigraph/core-models';
import { RoleController } from '../controllers/role.controller.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.get('/', requirePermission('roles:read'), RoleController.list);

router.get('/:id', requirePermission('roles:read'), validate({ params: roleIdParamSchema }), RoleController.get);

router.post('/', requirePermission('roles:write'), validate({ body: createRoleSchema }), RoleController.create);

router.put('/:id', requirePermission('roles:write'), validate({ params: roleIdParamSchema, body: updateRoleSchema }), RoleController.update);

router.delete('/:id', requirePermission('roles:write'), validate({ params: roleIdParamSchema }), RoleController.delete);

export default router;
