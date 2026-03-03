// ===========================================
// Route Aggregator
// ===========================================
// Combines all route modules under /api/v1 prefix.

import { Router, type IRouter } from 'express';
import alertRoutes from './alert.routes.js';
import authRoutes from './auth.routes.js';
import channelDependencyRoutes from './channel-dependency.routes.js';
import channelExportRoutes from './channel-export.routes.js';
import channelGroupRoutes from './channel-group.routes.js';
import dataPrunerRoutes from './data-pruner.routes.js';
import channelRoutes from './channel.routes.js';
import codeTemplateRoutes from './code-template.routes.js';
import deploymentRoutes from './deployment.routes.js';
import eventRoutes from './event.routes.js';
import globalScriptRoutes from './global-script.routes.js';
import messageRoutes from './message.routes.js';
import resourceRoutes from './resource.routes.js';
import scriptValidationRoutes from './script-validation.routes.js';
import settingsRoutes from './settings.routes.js';
import statisticsRoutes from './statistics.routes.js';
import tagRoutes from './tag.routes.js';
import userRoutes from './user.routes.js';

const router: IRouter = Router();

// Health check (unauthenticated, used by Playwright + load balancers)
router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// API v1 routes
router.use('/alerts', alertRoutes);
router.use('/auth', authRoutes);
// Mount specific /channels sub-routes BEFORE channelRoutes — channelRoutes
// defines GET /:id which greedily matches any single-segment path like
// /statistics or /status, causing UUID validation failures.
router.use('/channels', channelExportRoutes);
router.use('/channels', channelDependencyRoutes);
router.use('/channels', deploymentRoutes);
router.use('/channels', messageRoutes);
router.use('/channels', statisticsRoutes);
router.use('/channels', channelRoutes);
router.use('/admin/prune', dataPrunerRoutes);
router.use('/channel-groups', channelGroupRoutes);
router.use('/code-templates', codeTemplateRoutes);
router.use('/events', eventRoutes);
router.use('/global-scripts', globalScriptRoutes);
router.use('/resources', resourceRoutes);
router.use('/scripts', scriptValidationRoutes);
router.use('/settings', settingsRoutes);
router.use('/tags', tagRoutes);
router.use('/users', userRoutes);

export default router;
