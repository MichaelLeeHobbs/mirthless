// ===========================================
// Route Aggregator
// ===========================================
// Combines all route modules under /api/v1 prefix.

import { Router, type IRouter } from 'express';
import authRoutes from './auth.routes.js';
import channelRoutes from './channel.routes.js';
import codeTemplateRoutes from './code-template.routes.js';
import deploymentRoutes from './deployment.routes.js';
import globalScriptRoutes from './global-script.routes.js';
import messageRoutes from './message.routes.js';
import statisticsRoutes from './statistics.routes.js';
import userRoutes from './user.routes.js';

const router: IRouter = Router();

// API v1 routes
router.use('/auth', authRoutes);
router.use('/channels', channelRoutes);
router.use('/channels', deploymentRoutes);
router.use('/channels', messageRoutes);
router.use('/channels', statisticsRoutes);
router.use('/code-templates', codeTemplateRoutes);
router.use('/global-scripts', globalScriptRoutes);
router.use('/users', userRoutes);

export default router;
