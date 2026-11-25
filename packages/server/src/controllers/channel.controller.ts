import type { Request, Response } from 'express';
import type {
  CreateChannelInput,
  UpdateChannelInput,
  ChannelListQuery,
  PatchChannelEnabledInput,
  ChannelAccessQuery,
} from '@galvanigraph/core-models';
import { AUDIT_ACTION } from '@galvanigraph/core-models';
import { deny, DENY_REASON } from '../middleware/permission.middleware.js';
import { ChannelService } from '../services/channel.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { recordReadBestEffort } from '../lib/audited-read.js';
import { redactChannelDetail } from '../lib/secret-redaction.js';
import logger from '../lib/logger.js';
import { getEngine } from '../engine.js';
import { channelScopeOf, holdsOnRouteChannel } from '../lib/channel-scope.js';
import { assertCertificatesInScope } from '../services/connector-tls-resolver.js';
import { GrantService } from '../services/grant.service.js';
import { db } from '../lib/db.js';
import { tryCatch } from 'stderr-lib';
import { isServiceError } from '../lib/service-error.js';
import { errorInfo } from '@galvanigraph/core-util';

/**
 * Refuses a save that changes the enabled flag from a caller without
 * `channels:deploy` on the channel: it decides what a restart brings back (#225).
 * The editor always sends the flag, so sending the stored value passes.
 * Answers the request itself when it returns false.
 */
async function enabledChangeAllowed(req: Request, res: Response, id: string, input: UpdateChannelInput): Promise<boolean> {
  if (input.enabled === undefined) return true;
  if (holdsOnRouteChannel(req, 'channels:deploy')) return true;
  const current = await ChannelService.getById(id);
  if (!current.ok) {
    // The update answers a missing channel; any other failure refuses the save.
    if (isServiceError(current.error, 'NOT_FOUND')) return true;
    logger.error({ ...errorInfo(current.error), channelId: id }, 'Could not read a channel to check an enabled change');
    res.status(mapErrorToStatus(current.error)).json({ success: false, error: errorResponse(current.error) });
    return false;
  }
  if (current.value.enabled === input.enabled) return true;
  deny(req, res, DENY_REASON.NO_PERMISSION);
  return false;
}

/**
 * Refuses a save that puts a store certificate's private key to use outside
 * the writer's channels (D-310). Answers the request itself when it returns false.
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
  static async access(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const { asOf } = req.query as unknown as ChannelAccessQuery;
    const result = await tryCatch(asOf === undefined ? GrantService.channelAccess(db, id) : GrantService.channelAccessAsOf(db, id, new Date(asOf)));
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

    // Connector credentials are unmasked only for a caller who could edit them on this channel.
    const canWrite = holdsOnRouteChannel(req, 'channels:write');
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
    if (!(await enabledChangeAllowed(req, res, id, input))) return;
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
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    const result = await ChannelService.setEnabled(id, enabled, context);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    logger.info({ channelId: id, enabled }, 'Channel enabled toggled');
    // Needs no channels:write, and records no credential read.
    res.json({ success: true, data: redactChannelDetail(result.value as unknown as Record<string, unknown>) });
  }
}
