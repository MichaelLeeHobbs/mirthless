// ===========================================
// API Key Controller
// ===========================================
// Issue, list, enable, disable and revoke API keys (D-313). The token is in
// the answer to an issue only; nothing else ever returns a secret.

import type { Request, Response } from 'express';
import { tryCatch } from 'stderr-lib';
import type { CreateApiKeyInput, ReplaceApiKeyInput, RevokeApiKeyInput } from '@galvanigraph/core-models';
import { ApiKeyService } from '../services/api-key.service.js';
import type { GrantActor } from '../services/grant.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';
import { errorInfo } from '@galvanigraph/core-util';

function actorOf(req: Request): GrantActor {
  return { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
}

async function answer(res: Response, work: Promise<unknown>, what: string, status = 200): Promise<void> {
  const result = await tryCatch(work);
  if (!result.ok) {
    const code = mapErrorToStatus(result.error);
    if (code === 500) logger.error(errorInfo(result.error), `Failed to ${what}`);
    res.status(code).json({ success: false, error: errorResponse(result.error) });
    return;
  }
  // The token is a secret: keep it out of any cache between here and the caller.
  if (status === 201) res.set('Cache-Control', 'no-store');
  res.status(status).json({ success: true, data: result.value });
}

export class ApiKeyController {
  static async list(_req: Request, res: Response): Promise<void> {
    await answer(res, ApiKeyService.list(), 'list API keys');
  }

  static async get(req: Request, res: Response): Promise<void> {
    await answer(res, ApiKeyService.get(req.params['id'] as string), 'read an API key');
  }

  static async issue(req: Request, res: Response): Promise<void> {
    await answer(res, ApiKeyService.issue(req.body as CreateApiKeyInput, actorOf(req)), 'issue an API key', 201);
  }

  static async setEnabled(req: Request, res: Response): Promise<void> {
    const { enabled } = req.body as { enabled: boolean };
    await answer(res, ApiKeyService.setEnabled(req.params['id'] as string, enabled, actorOf(req)), 'change an API key');
  }

  static async replace(req: Request, res: Response): Promise<void> {
    const { mode } = req.body as ReplaceApiKeyInput;
    // 201 with the new token, kept out of caches like an issue's.
    await answer(res, ApiKeyService.replace(req.params['id'] as string, mode, actorOf(req)), 'replace an API key', 201);
  }

  static async revoke(req: Request, res: Response): Promise<void> {
    const { reason } = req.body as RevokeApiKeyInput;
    await answer(res, ApiKeyService.revoke(req.params['id'] as string, reason, actorOf(req)), 'revoke an API key');
  }
}
