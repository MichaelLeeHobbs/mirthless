import type { CreateEventInput } from '@galvanigraph/core-models';
import { EventService } from '../services/event.service.js';
import { AuditService, type AuditRecordInput } from '../services/audit.service.js';
import logger from './logger.js';

export interface AuditContext {
  readonly userId?: string | null;
  readonly ipAddress?: string | null;
}

export function emitEvent(input: CreateEventInput): void {
  EventService.create(input).then((result) => {
    if (!result.ok) {
      logger.warn({ errMsg: result.error.message, event: input.name }, 'Failed to emit event');
    }
  }).catch((err: unknown) => {
    logger.warn({ errMsg: err instanceof Error ? err.message : String(err), event: input.name }, 'Failed to emit event');
  });
}

/** Best effort (D-312). When losing the record must refuse the request, use AuditService.recordOrRefuse. */
export function emitAuditEvent(input: AuditRecordInput, onWritten?: () => void): void {
  AuditService.record(input).then((result) => {
    if (!result.ok) {
      lostAuditRecords += 1;
      logger.warn({ errMsg: result.error.message, action: input.action }, 'Failed to write audit record');
      return;
    }
    onWritten?.();
  }).catch((err: unknown) => {
    lostAuditRecords += 1;
    logger.warn({ errMsg: err instanceof Error ? err.message : String(err), action: input.action }, 'Failed to write audit record');
  });
}

let lostAuditRecords = 0;

export function lostAuditRecordCount(): number {
  return lostAuditRecords;
}

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
