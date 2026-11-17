// ===========================================
// Script Validation Controller
// ===========================================
// Handles HTTP request for script syntax validation.

import type { Request, Response } from 'express';
import { holdsPermission, type ScriptTestRunInput } from '@galvanigraph/core-models';
import { ScriptValidationService } from '../services/script-validation.service.js';
import { ScriptTestRunService } from '../services/script-test-run.service.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import logger from '../lib/logger.js';
import { holdsOnChannel } from '../lib/channel-scope.js';
import { deny, DENY_REASON } from '../middleware/permission.middleware.js';

export class ScriptValidationController {
  static async validate(req: Request, res: Response): Promise<void> {
    const { script, language } = req.body as {
      script: string;
      language: 'javascript' | 'typescript';
    };

    const result = await ScriptValidationService.validate(script, language);

    if (!result.ok) {
      logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Script validation service error');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }

  /** Run a script against a sample message. The sample is never logged. */
  static async testRun(req: Request, res: Response): Promise<void> {
    const input = req.body as ScriptTestRunInput;
    const context = { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
    // The channel named in the body must be one the caller may write (D-310):
    // outside the scope it answers as a channel that does not exist.
    const grants = req.principal?.grants;
    if (input.channelId !== undefined && !(grants !== undefined && await holdsOnChannel(grants, 'channels:write', input.channelId))) {
      deny(req, res, DENY_REASON.OUT_OF_SCOPE);
      return;
    }
    const held = req.user?.permissions;
    const result = await ScriptTestRunService.run(input, context, {
      resources: holdsPermission(held, 'resources:read'),
      collections: holdsPermission(held, 'collections:read'),
    });

    if (!result.ok) {
      // The error text can quote the script or sample (PHI), so only its code is logged.
      const errCode = (result.error as { code?: unknown }).code;
      logger.error({ errCode: typeof errCode === 'string' ? errCode : result.error.name, kind: input.kind, channelId: input.channelId }, 'Script test run failed');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }
}
