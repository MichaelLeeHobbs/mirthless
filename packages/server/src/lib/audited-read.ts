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
import { emitAuditEvent } from './event-emitter.js';

const dedupe = new AuditDedupe();

export interface AuditedRead {
  readonly action: string;
  readonly channelId?: string | null;
  /** What was read: filters, ids, counts. Never message content. */
  readonly attributes: Record<string, unknown>;
  /**
   * The read's dedupe key (route, channel, message id or filters with page)
   * and the message ids it returned, at most a page (200). Omit to record
   * every time. `idsOnlyForDedupe` keeps the ids out of the record, for ids
   * that can themselves be PHI (global map keys) or are not ids (log lines).
   */
  readonly dedupe?: { readonly key: string; readonly ids: readonly (string | number)[]; readonly idsOnlyForDedupe?: boolean };
}

/**
 * Record `read` for the signed-in caller, best effort: the request goes on
 * whether or not the row is written, and a lost row is counted for system
 * info (D-312). For reads the plan does not make fail-closed: the maps,
 * collections, the server log, unmasked secrets and Events page searches.
 */
export function recordReadBestEffort(req: Request, read: AuditedRead): void {
  const userId = req.user?.id ?? null;
  let attributes = read.attributes;
  let key: string | undefined;
  let ids: readonly (string | number)[] = [];
  if (read.dedupe !== undefined) {
    key = `${userId ?? '-'}|${read.dedupe.key}`;
    const toRecord = dedupe.idsToRecord(key, read.dedupe.ids, Date.now());
    if (toRecord === null) return;
    ids = toRecord;
    if (ids.length > 0 && read.dedupe.idsOnlyForDedupe !== true) attributes = { ...attributes, ids };
  }
  const remembered = key;
  emitAuditEvent({
    action: read.action, outcome: 'SUCCESS', userId,
    channelId: read.channelId ?? null, ipAddress: req.ip ?? null, attributes,
  }, () => {
    // Only a written record holds back the repeats; a lost one leaves them to be recorded.
    if (remembered !== undefined) dedupe.remember(remembered, ids, Date.now());
  });
}

/**
 * Record `read` for the signed-in caller before anything is sent. A deduped
 * read records every id the page returned that is not recorded yet (D-317),
 * so the dedupe never holds an id that was not written. Returns false when
 * the record could not be written: the request has then been answered 503
 * and the caller must send nothing more.
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
    attributes = { ...attributes, messageIds: ids };
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
