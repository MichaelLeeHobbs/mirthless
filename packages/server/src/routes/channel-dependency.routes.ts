// ===========================================
// Channel Dependency Routes
// ===========================================
// Mounted under /channels prefix in the route aggregator.

import { Router, type IRouter } from 'express';
import {
  setDependenciesSchema,
  channelDependencyParamSchema,
} from '@mirthless/core-models';
import { ChannelDependencyService } from '../services/channel-dependency.service.js';
import { isServiceError } from '../lib/service-error.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import logger from '../lib/logger.js';

const router: IRouter = Router();

router.use(authenticate);

function mapErrorToStatus(error: unknown): number {
  if (isServiceError(error, 'NOT_FOUND')) return 404;
  if (isServiceError(error, 'INVALID_INPUT')) return 400;
  return 500;
}

function errorResponse(error: unknown): { code: string; message: string } {
  if (isServiceError(error)) return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: 'Internal server error' };
}

router.get(
  '/:id/dependencies',
  requirePermission('channels:read'),
  validate({ params: channelDependencyParamSchema }),
  async (req, res) => {
    const id = req.params['id'] as string;
    const result = await ChannelDependencyService.getDependencies(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId: id }, 'Failed to get dependencies');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  },
);

router.put(
  '/:id/dependencies',
  requirePermission('channels:deploy'),
  validate({ params: channelDependencyParamSchema, body: setDependenciesSchema }),
  async (req, res) => {
    const id = req.params['id'] as string;
    const input = req.body as { dependsOnChannelIds: string[] };
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelDependencyService.setDependencies(id, input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId: id }, 'Failed to set dependencies');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  },
);

router.get(
  '/:id/dependents',
  requirePermission('channels:read'),
  validate({ params: channelDependencyParamSchema }),
  async (req, res) => {
    const id = req.params['id'] as string;
    const result = await ChannelDependencyService.getDependents(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId: id }, 'Failed to get dependents');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  },
);

export default router;
