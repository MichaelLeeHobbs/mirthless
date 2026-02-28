// ===========================================
// User Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
  userIdParamSchema,
} from '@mirthless/core-models';
import { UserController } from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

// All user routes require authentication
router.use(authenticate);

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

router.put(
  '/:id',
  requirePermission('users:write'),
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  UserController.update,
);

router.delete(
  '/:id',
  requirePermission('users:delete'),
  validate({ params: userIdParamSchema }),
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
