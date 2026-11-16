// ===========================================
// Audited Reads
// ===========================================
// A PHI read is recorded in the audit log before its content is sent, and is
// refused with 503 AUDIT_UNAVAILABLE when the record cannot be written
// (D-312). Repeats of the same read by the same caller are deduped
// (audit-dedupe.ts); exports and attachment downloads pass no dedupe key, so
// they are recorded every time.

import type { Request, Response } from 'express';
import { AuditService } from '../services/audit.service.js';
import { AuditDedupe } from './audit-dedupe.js';
import { errorResponse, mapErrorToStatus } from './controller-helpers.js';

/** The most message ids one search record lists. */
export const MAX_RECORDED_IDS = 100;

const dedupe = new AuditDedupe();

export interface AuditedRead {
  readonly action: string;
  readonly channelId?: string | null;
  /** What was read: filters, ids, counts. Never message content. */
  readonly attributes: Record<string, unknown>;
  /**
   * The read's dedupe key (route, channel, message id or filters with page)
   * and the message ids it returned. Omit to record every time.
   */
  readonly dedupe?: { readonly key: string; readonly ids: readonly (string | number)[] };
}

/**
 * Record `read` for the signed-in caller before anything is sent. Returns
 * false when the record could not be written: the request has then been
 * answered 503 and the caller must send nothing more.
 */
export async function recordReadOrRefuse(req: Request, res: Response, read: AuditedRead): Promise<boolean> {
  const userId = req.user?.id ?? null;
  const key = read.dedupe === undefined ? undefined : `${userId ?? '-'}|${read.dedupe.key}`;
  let attributes = read.attributes;
  let ids: readonly (string | number)[] = [];
  if (key !== undefined && read.dedupe !== undefined) {
    const toRecord = dedupe.idsToRecord(key, read.dedupe.ids, Date.now());
    if (toRecord === null) return true;
    ids = toRecord;
    attributes = { ...attributes, messageIds: ids.slice(0, MAX_RECORDED_IDS) };
  }
  const recorded = await AuditService.recordOrRefuse({
    action: read.action, outcome: 'SUCCESS', userId,
    channelId: read.channelId ?? null, ipAddress: req.ip ?? null, attributes,
  });
  if (!recorded.ok) {
    res.status(mapErrorToStatus(recorded.error)).json({ success: false, error: errorResponse(recorded.error) });
    return false;
  }
  if (key !== undefined) dedupe.remember(key, ids, Date.now());
  return true;
}
