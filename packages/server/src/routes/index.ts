// ===========================================
// Route Aggregator
// ===========================================
// Combines all route modules under /api/v1 prefix.

import { Router, type IRouter } from 'express';
import authRoutes from './auth.routes.js';
import channelRoutes from './channel.routes.js';

const router: IRouter = Router();

// API v1 routes
router.use('/auth', authRoutes);
router.use('/channels', channelRoutes);

export default router;
