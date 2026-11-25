import { isDeepStrictEqual } from 'node:util';
import type { Request, Response } from 'express';
import { ALL_CHANNELS, type ConnectionTestInput, type FoldedGrants } from '@galvanigraph/core-models';
import { ConfigMapService } from '../services/config-map.service.js';
import { ConnectionTestService } from '../services/connection-test.service.js';
import { errorInfo } from '@galvanigraph/core-util';
import { assertCertificatesInScope } from '../services/connector-tls-resolver.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { holdsOnChannel } from '../lib/channel-scope.js';
import { resolveConfigReferences } from '../lib/config-references.js';
import { deny, DENY_REASON } from '../middleware/permission.middleware.js';
import { ServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

function refuse(res: Response, error: ServiceError): void {
  res.status(mapErrorToStatus(error)).json({ success: false, error: errorResponse(error) });
}

/**
 * A deployer scoped to some groups tests for a channel in their scope, and may
 * use only certificates their channels already use (D-310): the store's
 * private keys could otherwise authenticate as another group's client. Returns
 * false when it answered the request.
 */
async function scopedTestAllowed(req: Request, res: Response, input: ConnectionTestInput): Promise<boolean> {
  const grants = req.principal?.grants;
  const scope = grants?.get('channels:deploy');
  if (grants === undefined || scope === undefined || scope === ALL_CHANNELS) return true;
  if (input.channelId === undefined) {
    refuse(res, new ServiceError('INVALID_INPUT', 'Name the channel this test is for (channelId)'));
    return false;
  }
  if (!(await holdsOnChannel(grants, 'channels:deploy', input.channelId))) {
    deny(req, res, DENY_REASON.OUT_OF_SCOPE);
    return false;
  }
  await assertCertificatesInScope(grants, 'channels:deploy', [input.properties]);
  return true;
}

/** As the map shows its values, or in a script of the channel, which reads them all. */
async function readsConfigMap(grants: FoldedGrants | undefined, channelId: string | undefined): Promise<boolean> {
  if (grants === undefined) return false;
  if (grants.get('config_map:read') === ALL_CHANNELS || grants.get('channels:write') === ALL_CHANNELS) return true;
  return channelId !== undefined && holdsOnChannel(grants, 'channels:write', channelId);
}

/**
 * The references of the configuration map filled, as a deploy fills them. A deploy fills what is saved;
 * here the caller names the server that gets the values and reads the answer, so it is only for one
 * who can read them anyway.
 */
async function filledProperties(req: Request, input: ConnectionTestInput): Promise<Record<string, unknown>> {
  const references = await ConfigMapService.references();
  if (!references.ok) throw new ServiceError('INTERNAL', 'Could not load the configuration map');
  const filled = resolveConfigReferences(input.properties, references.value);
  if (isDeepStrictEqual(filled, input.properties) || await readsConfigMap(req.principal?.grants, input.channelId)) return filled;
  throw new ServiceError('FORBIDDEN', 'These settings hold a reference to the configuration map. To test them with its value you need config_map:read, or channels:write on the channel the test is for');
}

export class ConnectionTestController {
  static async test(req: Request, res: Response): Promise<void> {
    const input = req.body as ConnectionTestInput;
    const { connectorType, mode } = input;
    let properties: Record<string, unknown>;
    try {
      if (!(await scopedTestAllowed(req, res, input))) return;
      properties = await filledProperties(req, input);
    } catch (err: unknown) {
      // A refusal is answered as such; anything else is a server fault.
      if (!(err instanceof ServiceError)) logger.error(errorInfo(err), 'Connection test could not be prepared');
      refuse(res, err instanceof ServiceError ? err : new ServiceError('INTERNAL', 'Connection test failed'));
      return;
    }

    const result = await ConnectionTestService.testConnection(
      connectorType,
      mode,
      properties,
    );

    if (!result.ok) {
      logger.warn({ errMsg: result.error.message, connectorType, mode }, 'Connection test failed');
      res.status(mapErrorToStatus(result.error)).json({ success: false, error: errorResponse(result.error) });
      return;
    }

    res.json({ success: true, data: result.value });
  }
}
