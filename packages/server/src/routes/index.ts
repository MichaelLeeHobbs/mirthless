// ===========================================
// Route Aggregator
// ===========================================
// Combines all route modules under /api/v1 prefix.

import { Router, type IRouter } from 'express';
import alertRoutes from './alert.routes.js';
import authRoutes from './auth.routes.js';
import attachmentRoutes from './attachment.routes.js';
import channelDependencyRoutes from './channel-dependency.routes.js';
import channelExportRoutes from './channel-export.routes.js';
import channelGroupRoutes from './channel-group.routes.js';
import mirthImportRoutes from './mirth-import.routes.js';
import channelRevisionRoutes from './channel-revision.routes.js';
import configMapRoutes from './config-map.routes.js';
import connectionTestRoutes from './connection-test.routes.js';
import crossChannelSearchRoutes from './cross-channel-search.routes.js';
import dataPrunerRoutes from './data-pruner.routes.js';
import extensionRoutes from './extension.routes.js';
import prunerSchedulerRoutes from './pruner-scheduler.routes.js';
import channelRoutes from './channel.routes.js';
import codeTemplateRoutes from './code-template.routes.js';
import deploymentRoutes from './deployment.routes.js';
import eventExportRoutes from './event-export.routes.js';
import eventRoutes from './event.routes.js';
import globalMapRoutes from './global-map.routes.js';
import logRoutes from './log.routes.js';
import messageGeneratorRoutes from './message-generator.routes.js';
import globalScriptRoutes from './global-script.routes.js';
import messageReprocessRoutes from './message-reprocess.routes.js';
import messageRoutes from './message.routes.js';
import resourceRoutes from './resource.routes.js';
import scriptValidationRoutes from './script-validation.routes.js';
import serverBackupRoutes from './server-backup.routes.js';
import settingsRoutes from './settings.routes.js';
import statisticsRoutes from './statistics.routes.js';
import systemInfoRoutes from './system-info.routes.js';
import tagRoutes from './tag.routes.js';
import userPreferenceRoutes from './user-preference.routes.js';
import certificateRoutes from './certificate.routes.js';
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
router.use('/channels', attachmentRoutes);
router.use('/channels', channelExportRoutes);
router.use('/channels/import/mirth', mirthImportRoutes);
router.use('/channels', channelRevisionRoutes);
router.use('/channels', channelDependencyRoutes);
router.use('/channels', deploymentRoutes);
router.use('/channels', messageReprocessRoutes);
router.use('/channels', messageRoutes);
router.use('/channels', statisticsRoutes);
router.use('/channels', channelRoutes);
router.use('/admin/prune', prunerSchedulerRoutes);
router.use('/admin/prune', dataPrunerRoutes);
router.use('/channel-groups', channelGroupRoutes);
router.use('/certificates', certificateRoutes);
router.use('/code-templates', codeTemplateRoutes);
router.use('/config-map', configMapRoutes);
router.use('/connectors/test', connectionTestRoutes);
router.use('/events/export', eventExportRoutes);
router.use('/events', eventRoutes);
router.use('/messages', crossChannelSearchRoutes);
router.use('/extensions', extensionRoutes);
router.use('/global-map', globalMapRoutes);
router.use('/global-scripts', globalScriptRoutes);
router.use('/resources', resourceRoutes);
router.use('/scripts', scriptValidationRoutes);
router.use('/settings', settingsRoutes);
router.use('/system/backup', serverBackupRoutes);
router.use('/system/logs', logRoutes);
router.use('/system', systemInfoRoutes);
router.use('/tags', tagRoutes);
router.use('/tools/messages', messageGeneratorRoutes);
router.use('/users/me/preferences', userPreferenceRoutes);
router.use('/users', userRoutes);

export default router;
