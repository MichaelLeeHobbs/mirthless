import { Router, type IRouter } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { authRateLimiter, refreshRateLimiter } from '../middleware/rate-limit.middleware.js';
import { authJsonBody } from '../middleware/body-limit.middleware.js';
import { z } from 'zod/v4';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const router: IRouter = Router();

// Login reads its body only after the limiter.
router.post('/login', authRateLimiter, authJsonBody, validate({ body: loginSchema }), AuthController.login);

// Refresh reads a cookie, so it has no body to validate.
router.post('/refresh', refreshRateLimiter, AuthController.refresh);

router.post('/logout', authenticate, AuthController.logout);

export default router;
