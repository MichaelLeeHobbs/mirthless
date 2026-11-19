import { Router, type IRouter } from 'express';
import {
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
  changeOwnPasswordSchema,
  userIdParamSchema,
  setAssignmentsSchema,
  deleteUserQuerySchema,
} from '@galvanigraph/core-models';
import { UserController } from '../controllers/user.controller.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

// No permission: every user may change their own password. Registered before
// `/:id/password` so `me` is not treated as an id.
router.post(
  '/me/password',
  validate({ body: changeOwnPasswordSchema }),
  UserController.changeOwnPassword,
);

router.get(
  '/',
  requirePermission('users:read'),
  UserController.list,
);

router.post(
  '/',
  requirePermission('users:write'),
  validate({ body: createUserSchema }),
  UserController.create,
);

router.get(
  '/:id',
  requirePermission('users:read'),
  validate({ params: userIdParamSchema }),
  UserController.getById,
);

router.get(
  '/:id/permissions',
  requirePermission('users:read'),
  validate({ params: userIdParamSchema }),
  UserController.getPermissions,
);

router.get(
  '/:id/assignments',
  requirePermission('users:read'),
  validate({ params: userIdParamSchema }),
  UserController.getAssignments,
);

router.put(
  '/:id/assignments',
  requirePermission('users:write'),
  validate({ params: userIdParamSchema, body: setAssignmentsSchema }),
  UserController.setAssignments,
);

router.put(
  '/:id',
  requirePermission('users:write'),
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  UserController.update,
);

router.delete(
  '/:id',
  requirePermission('users:delete'),
  validate({ params: userIdParamSchema, query: deleteUserQuerySchema }),
  UserController.delete,
);

router.post(
  '/:id/password',
  requirePermission('users:write'),
  validate({ params: userIdParamSchema, body: changePasswordSchema }),
  UserController.changePassword,
);

router.post(
  '/:id/unlock',
  requirePermission('users:write'),
  validate({ params: userIdParamSchema }),
  UserController.unlock,
);

export default router;
