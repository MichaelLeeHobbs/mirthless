// ===========================================
// Channel Controller
// ===========================================
// Handles HTTP requests for channel CRUD operations.
// Validates input, calls service, formats responses.

import type { Request, Response } from 'express';
import type {
  CreateChannelInput,
  UpdateChannelInput,
  ChannelListQuery,
  PatchChannelEnabledInput,
} from '@galvanigraph/core-models';
import { AUDIT_ACTION, holdsPermission } from '@galvanigraph/core-models';
import { ChannelService } from '../services/channel.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { recordReadBestEffort } from '../lib/audited-read.js';
import { redactChannelDetail } from '../lib/secret-redaction.js';
import logger from '../lib/logger.js';
import { getEngine } from '../engine.js';
import { channelScopeOf } from '../lib/channel-scope.js';
import { assertCertificatesInScope } from '../services/connector-tls-resolver.js';
import { GrantService } from '../services/grant.service.js';
import { db } from '../lib/db.js';
import { tryCatch } from 'stderr-lib';
import { isServiceError } from '../lib/service-error.js';
import { errorInfo } from '@galvanigraph/core-util';

/**
 * Refuse a save that puts a store certificate's private key to use outside
 * the writer's channels (D-310). Answers the request and returns false when
 * refused; an unexpected failure is logged and answered as a server fault.
 */
async function certificatesAllowed(req: Request, res: Response, connectorProps: readonly unknown[]): Promise<boolean> {
  try {
    await assertCertificatesInScope(req.principal?.grants, 'channels:write', connectorProps);
    return true;
  } catch (err: unknown) {
    if (!isServiceError(err)) logger.error(errorInfo(err), 'Certificate scope check failed');
    res.status(mapErrorToStatus(err)).json({ success: false, error: errorResponse(err) });
    return false;
  }
}

export class ChannelController {
  /** GET /channels/:id/access: who can access the channel now, and how. */
  static async access(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await tryCatch(GrantService.channelAccess(db, id));
    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      if (status === 500) logger.error({ ...errorInfo(result.error), channelId: id }, 'Failed to list who can access a channel');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }
    res.json({ success: true, data: result.value });
  }

  static async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as ChannelListQuery;
    const result = await ChannelService.list(query, await channelScopeOf(req, 'channels:read'));

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Failed to list channels');
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await ChannelService.getById(id);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    // Mask connector credentials (DB/SFTP passwords, API keys, private keys)
    // for read-only callers. Only a caller who can already edit the channel
    // (`channels:write`) sees the real values; everyone else, notably the
    // `viewer` role, gets the redacted marker.
    const canWrite = holdsPermission(req.user?.permissions, 'channels:write');
    const data = canWrite
      ? result.value
      : redactChannelDetail(result.value as unknown as Record<string, unknown>);
    // Unmasked connector credentials: recorded, best effort (D-312).
    if (canWrite) {
      recordReadBestEffort(req, {
        action: AUDIT_ACTION.CHANNEL_SECRETS_READ, channelId: id, attributes: { revision: null },
        dedupe: { key: `channel-secrets|${id}`, ids: [id] },
      });
    }

    res.json({ success: true, data });
  }

  static async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateChannelInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    if (!(await certificatesAllowed(req, res, [input.sourceConnectorProperties, ...(input.destinations ?? []).map((d) => d.properties)]))) return;
    const result = await ChannelService.create(input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelName: input.name }, 'Failed to create channel');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: result.value.id }, 'Channel created');
    res.status(201).json({ success: true, data: result.value });
  }

  static async update(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as UpdateChannelInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    if (!(await certificatesAllowed(req, res, [input.sourceConnectorProperties, ...(input.destinations ?? []).map((d) => d.properties)]))) return;
    const result = await ChannelService.update(id, input, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId: id }, 'Failed to update channel');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: id }, 'Channel updated');
    res.json({ success: true, data: result.value });
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    // A deployed channel keeps receiving and routing messages after its row is
    // soft-deleted, with nothing left in the UI to stop it. Require undeploy first.
    if (getEngine().getRuntime(id)) {
      res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Cannot delete a deployed channel. Stop and undeploy it first.' } });
      return;
    }
    const result = await ChannelService.delete(id, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId: id }, 'Failed to delete channel');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: id }, 'Channel deleted');
    res.status(204).send();
  }

  static async clone(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const { name, groupId } = req.body as { name: string; groupId?: string };
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelService.clone(id, name, context, groupId);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId: id }, 'Failed to clone channel');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: result.value.id, clonedFrom: id }, 'Channel cloned');
    res.status(201).json({ success: true, data: result.value });
  }

  static async setEnabled(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const { enabled } = req.body as PatchChannelEnabledInput;
    const result = await ChannelService.setEnabled(id, enabled);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: id, enabled }, 'Channel enabled toggled');
    res.json({ success: true, data: result.value });
  }
}
