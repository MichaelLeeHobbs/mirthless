// ===========================================
// Event Emitter
// ===========================================
// Fire-and-forget helper for creating audit events.
// If event recording fails, the original operation still succeeds.

import type { CreateEventInput } from '@galvanigraph/core-models';
import { EventService } from '../services/event.service.js';
import { AuditService, type AuditRecordInput } from '../services/audit.service.js';
import logger from './logger.js';

/** Audit context passed from controllers. */
export interface AuditContext {
  readonly userId?: string | null;
  readonly ipAddress?: string | null;
}

/**
 * Fire-and-forget event emission. Non-blocking — failures are logged
 * at WARN level but never propagated to the caller.
 */
export function emitEvent(input: CreateEventInput): void {
  EventService.create(input).then((result) => {
    if (!result.ok) {
      logger.warn({ errMsg: result.error.message, event: input.name }, 'Failed to emit event');
    }
  }).catch((err: unknown) => {
    logger.warn({ errMsg: err instanceof Error ? err.message : String(err), event: input.name }, 'Failed to emit event');
  });
}

/**
 * Write an audit_log row, best effort (D-312): a failure is logged at WARN and
 * never reaches the caller. For records whose loss must refuse the request,
 * use AuditService.recordOrRefuse instead.
 */
export function emitAuditEvent(input: AuditRecordInput): void {
  AuditService.record(input).then((result) => {
    if (!result.ok) {
      lostAuditRecords += 1;
      logger.warn({ errMsg: result.error.message, action: input.action }, 'Failed to write audit record');
    }
  }).catch((err: unknown) => {
    lostAuditRecords += 1;
    logger.warn({ errMsg: err instanceof Error ? err.message : String(err), action: input.action }, 'Failed to write audit record');
  });
}

let lostAuditRecords = 0;

/** Best-effort audit records this process failed to write since it started. System info shows it. */
export function lostAuditRecordCount(): number {
  return lostAuditRecords;
}

/**
 * Emit an INFO / SUCCESS audit event for a change made by the caller in
 * `context`, with no channel or server. `attributes` says what changed.
 */
export function emitSuccessEvent(
  name: string,
  context: AuditContext | undefined,
  attributes: Record<string, unknown>,
): void {
  emitEvent({
    level: 'INFO', name, outcome: 'SUCCESS',
    userId: context?.userId ?? null, channelId: null,
    serverId: null, ipAddress: context?.ipAddress ?? null,
    attributes,
  });
}
