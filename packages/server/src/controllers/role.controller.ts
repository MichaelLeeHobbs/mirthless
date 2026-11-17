// ===========================================
// Role Controller
// ===========================================
// Roles are rows (D-310). Every write goes through GrantService in one
// transaction with its audit row; a refusal that names what is in the way
// (the permissions the editor lacks, the assignments that keep a role in use)
// carries them in `details`.

import type { Request, Response } from 'express';
import { tryCatch, type Result } from 'stderr-lib';
import { holdsPermission, type CreateRoleInput, type UpdateRoleInput } from '@galvanigraph/core-models';
import { GrantService, type GrantActor, type RoleSummary } from '../services/grant.service.js';
import { db } from '../lib/db.js';
import { mapErrorToStatus, errorResponse } from '../lib/controller-helpers.js';
import { isServiceError, ServiceError } from '../lib/service-error.js';
import logger from '../lib/logger.js';

function actorOf(req: Request): GrantActor {
  return { userId: req.user?.id ?? null, ipAddress: req.ip ?? null };
}

/** Answer a failed result: its status, its code and message, and its details when the service gave any. */
function fail(res: Response, error: unknown, what: string): void {
  const status = mapErrorToStatus(error);
  if (status === 500) logger.error({ errMsg: error instanceof Error ? error.message : String(error) }, `Failed to ${what}`);
  const details = isServiceError(error) ? error.details : undefined;
  res.status(status).json({ success: false, error: { ...errorResponse(error), ...(details ? { details } : {}) } });
}

/**
 * A delete refused while the role is assigned names who holds it. Only a
 * caller who may read users sees those names; anyone else gets the count.
 */
function withoutUsersUnlessAllowed(req: Request, error: unknown): unknown {
  if (!isServiceError(error) || !Array.isArray(error.details?.['assignments'])) return error;
  if (holdsPermission(req.user?.permissions, 'users:read')) return error;
  const count = (error.details['assignments'] as unknown[]).length;
  return new ServiceError(error.code, error.message, { assignments: count });
}

async function answerRole(res: Response, id: Result<string>, status: number, what: string): Promise<void> {
  if (!id.ok) { fail(res, id.error, what); return; }
  const role = await tryCatch(GrantService.getRole(id.value));
  if (!role.ok) { fail(res, role.error, what); return; }
  res.status(status).json({ success: true, data: role.value });
}

export class RoleController {
  static async list(_req: Request, res: Response): Promise<void> {
    const result: Result<readonly RoleSummary[]> = await tryCatch(GrantService.listRoles());
    if (!result.ok) { fail(res, result.error, 'list roles'); return; }
    res.json({ success: true, data: result.value });
  }

  static async get(req: Request, res: Response): Promise<void> {
    const result = await tryCatch(GrantService.getRole(req.params['id'] as string));
    if (!result.ok) { fail(res, result.error, 'get role'); return; }
    res.json({ success: true, data: result.value });
  }

  static async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateRoleInput;
    const id = await tryCatch(db.transaction((tx) => GrantService.createRole(tx, input, actorOf(req))));
    await answerRole(res, id, 201, 'create role');
  }

  static async update(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const input = req.body as UpdateRoleInput;
    const done = await tryCatch(db.transaction(async (tx) => { await GrantService.updateRole(tx, id, input, actorOf(req)); return id; }));
    await answerRole(res, done, 200, 'update role');
  }

  static async delete(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const result = await tryCatch(db.transaction((tx) => GrantService.deleteRole(tx, id, actorOf(req))));
    if (!result.ok) { fail(res, withoutUsersUnlessAllowed(req, result.error), 'delete role'); return; }
    res.status(204).end();
  }
}
