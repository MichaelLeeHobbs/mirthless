import type { Request, Response } from 'express';
import { AUDIT_ACTION, holdsPermission } from '@galvanigraph/core-models';
import { recordReadBestEffort } from '../lib/audited-read.js';
import { ChannelRevisionService } from '../services/channel-revision.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';
import { redactChannelDetail } from '../lib/secret-redaction.js';

export class ChannelRevisionController {
  static async list(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const result = await ChannelRevisionService.listRevisions(channelId);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack, channelId }, 'Failed to list revisions');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  static async getByRevision(req: Request, res: Response): Promise<void> {
    const channelId = req.params['id'] as string;
    const rev = Number(req.params['rev']);
    const result = await ChannelRevisionService.getRevision(channelId, rev);

    if (!result.ok) {
      const status = mapErrorToStatus(result.error);
      logger.warn({ errMsg: result.error.message, channelId, rev }, 'Failed to get revision');
      res.status(status).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    // A snapshot carries the full connector config; readers without
    // channels:write get credentials masked exactly as on GET /channels/:id.
    const canWrite = holdsPermission(req.user?.permissions, 'channels:write');
    const data = canWrite
      ? result.value
      : { ...result.value, snapshot: redactChannelDetail(result.value.snapshot) };
    if (canWrite) {
      recordReadBestEffort(req, {
        action: AUDIT_ACTION.CHANNEL_SECRETS_READ, channelId, attributes: { revision: rev },
        dedupe: { key: `channel-secrets|${channelId}|${String(rev)}`, ids: [rev] },
      });
    }

    res.json({ success: true, data });
  }
}
