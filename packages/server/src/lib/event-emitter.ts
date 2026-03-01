// ===========================================
// Event Emitter
// ===========================================
// Fire-and-forget helper for creating audit events.
// If event recording fails, the original operation still succeeds.

import type { CreateEventInput } from '@mirthless/core-models';
import { EventService } from '../services/event.service.js';
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
      logger.warn({ error: result.error, event: input.name }, 'Failed to emit event');
    }
  }).catch((err: unknown) => {
    logger.warn({ error: err, event: input.name }, 'Failed to emit event');
  });
}
