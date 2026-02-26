// ===========================================
// Auth Routes
// ===========================================

import { Router, type IRouter } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { authRateLimiter } from '../middleware/rate-limit.middleware.js';
import { z } from 'zod/v4';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const router: IRouter = Router();

// Public routes (with rate limiting)
router.post('/login', authRateLimiter, validate({ body: loginSchema }), AuthController.login);

// Refresh uses cookie — no body validation needed
router.post('/refresh', AuthController.refresh);

// Logout requires authentication
router.post('/logout', authenticate, AuthController.logout);

export default router;
