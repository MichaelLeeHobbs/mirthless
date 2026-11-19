import { Router, type IRouter } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { apiKeyRateLimiter } from '../middleware/rate-limit.middleware.js';
import apiKeyRoutes from './api-key.routes.js';
import { jsonBody } from '../middleware/body-limit.middleware.js';
import alertRoutes from './alert.routes.js';
import auditRoutes from './audit.routes.js';
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
import roleRoutes from './role.routes.js';
import collectionRoutes from './collection.routes.js';
import dataSourceRoutes from './data-source.routes.js';
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

// Public: the only routes a caller without a session reaches (D-299). Add one
// only with its reason in PUBLIC_ROUTES (__tests__/api-routes.ts).

// Health check, used by Playwright and load balancers
router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
// Login and refresh (each behind its own rate limiter). Logout authenticates itself.
router.use('/auth', authRoutes);

// One guard for the whole API. Routers must not add their own: ten routers share
// the /channels mount, and each one's guard would run again (#217).
router.use(authenticate);
// Counted per API key once the key is known; a person's request skips it.
router.use(apiKeyRateLimiter);
// Bodies are read only now, after the guard (#157); large-body routers parse their own.
router.use(jsonBody);

router.use('/alerts', alertRoutes);
router.use('/api-keys', apiKeyRoutes);
router.use('/audit', auditRoutes);
// Specific /channels sub-routers go before channelRoutes, whose GET /:id would
// capture paths like /status and fail UUID validation.
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
router.use('/roles', roleRoutes);
router.use('/collections', collectionRoutes);
router.use('/datasources', dataSourceRoutes);
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
