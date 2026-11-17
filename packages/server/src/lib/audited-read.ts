// ===========================================
// Audited Reads
// ===========================================
// A PHI read is recorded in the audit log before its content is sent, and is
// refused with 503 AUDIT_UNAVAILABLE when the record cannot be written
// (D-312). Repeats of the same read by the same caller are deduped
// (audit-dedupe.ts); exports and attachment downloads pass no dedupe key, so
// they are recorded every time.
//
// A read by an API key is never deduped: it records the message rows it
// returns, and those count against the key's daily row ceiling
// (key-row-ceiling.ts, D-313). A read that would pass the ceiling is refused
// with 429 before anything is sent.

import type { Request, Response } from 'express';
import { AuditService } from '../services/audit.service.js';
import { AuditDedupe } from './audit-dedupe.js';
import { errorResponse, mapErrorToStatus } from './controller-helpers.js';
import { emitAuditEvent } from './event-emitter.js';
import { DEFAULT_KEY_DAILY_ROWS, KeyRowCeiling, type RowTicket } from './key-row-ceiling.js';
import { ServiceError } from './service-error.js';
import logger from './logger.js';
import { errorInfo } from '@galvanigraph/core-util';
import { AUDIT_ACTION } from '@galvanigraph/core-models';

const dedupe = new AuditDedupe();

const keyDailyRows = ((): number => {
  const configured = Number(process.env['API_KEY_DAILY_ROWS']);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_KEY_DAILY_ROWS;
})();

const keyCeiling = new KeyRowCeiling({ limit: keyDailyRows, seed: (userId, since) => AuditService.rowsReadSince(userId, since) });

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
  /** The rows the read returns (messages, collection records), counted against an API key's daily ceiling. Omit for a read that returns none. */
  readonly rows?: number;
}

/** Answer `res` with the refusal `error` carries. */
function refuse(res: Response, error: unknown): void {
  res.status(mapErrorToStatus(error)).json({ success: false, error: errorResponse(error) });
}

/**
 * Record a read made with an API key, every time and with its rows, after
 * counting the rows against the key's ceiling. Returns the record's id, or
 * null when the request has been answered: 429 over the ceiling (recorded
 * once a day per key), 503 when today's count or the record could not be
 * read or written.
 */
async function recordKeyRead(req: Request, res: Response, read: Omit<AuditedRead, 'dedupe'>, attributes: Record<string, unknown>): Promise<number | null> {
  const userId = req.user?.id;
  if (userId === undefined) {
    refuse(res, new ServiceError('UNAUTHORIZED', 'Sign in to read this'));
    return null;
  }
  const rows = read.rows ?? 0;
  let ticket: RowTicket | null;
  try {
    ticket = await keyCeiling.take(userId, rows);
  } catch (err: unknown) {
    // Today's count could not be read from the audit log: refuse, as any read the log cannot account for is.
    logger.error({ ...errorInfo(err), apiKeyId: req.apiKeyId }, 'Could not read an API key\'s rows for today; refusing the read');
    refuse(res, new ServiceError('AUDIT_UNAVAILABLE', 'The audit log could not be read to count this API key\'s rows, so the read was refused. Try again, and tell an administrator if it keeps happening.'));
    return null;
  }
  if (ticket === null) {
    await recordCeilingRefusal(req, userId, read, rows);
    const message = rows > keyCeiling.limit
      ? `This read returns ${String(rows)} rows, more than an API key may read in a day (${String(keyCeiling.limit)}). Ask for fewer.`
      : `This API key has read its ${String(keyCeiling.limit)} rows (messages and collection records) for today (UTC). It can read more tomorrow.`;
    res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message } });
    return null;
  }
  const recorded = await AuditService.recordOrRefuse({
    action: read.action, outcome: 'SUCCESS', userId, channelId: read.channelId ?? null, ipAddress: req.ip ?? null,
    attributes: read.rows === undefined ? attributes : { ...attributes, rows },
  });
  if (!recorded.ok) {
    keyCeiling.giveBack(ticket);
    refuse(res, recorded.error);
    return null;
  }
  return recorded.value;
}

/**
 * Record, once a day per key, that a read was refused at the ceiling. A day's
 * count is rebuilt from each record's `rows`, so the refused read's are named
 * refusedRows. When the record cannot be written the next refusal tries again.
 */
async function recordCeilingRefusal(req: Request, userId: string, read: Omit<AuditedRead, 'dedupe'>, rows: number): Promise<void> {
  if (!keyCeiling.firstRefusalToday(userId)) return;
  const recorded = await AuditService.recordOrRefuse({
    action: AUDIT_ACTION.API_KEY_ROW_CEILING_REACHED, outcome: 'FAILURE', userId, channelId: read.channelId ?? null,
    ipAddress: req.ip ?? null,
    attributes: { apiKeyId: req.apiKeyId, limit: keyCeiling.limit, refusedRead: read.action, refusedRows: rows },
  });
  if (!recorded.ok) keyCeiling.forgetRefusal(userId);
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
 * A best-effort read whose rows an API key may not take without limit:
 * collection records, which can hold PHI from many channels. A person's read
 * is recorded best effort, as before; a key's is counted against its daily
 * ceiling and recorded fail-closed, like a message read (D-313). Returns false
 * when the request has been answered (429 or 503).
 */
export async function recordCountedRead(req: Request, res: Response, read: AuditedRead): Promise<boolean> {
  if (req.apiKeyId === undefined) {
    recordReadBestEffort(req, read);
    return true;
  }
  return recordReadOrRefuse(req, res, read);
}

/**
 * Record an export for the signed-in caller before the file is sent, never
 * deduped, and return the audit row's id for the file's header. Returns null
 * when the record could not be written: the request has then been answered
 * 503 and the caller must send nothing more.
 */
export async function recordExportOrRefuse(req: Request, res: Response, read: Omit<AuditedRead, 'dedupe'>): Promise<number | null> {
  if (req.apiKeyId !== undefined) return recordKeyRead(req, res, read, read.attributes);
  const recorded = await AuditService.recordOrRefuse({
    action: read.action, outcome: 'SUCCESS', userId: req.user?.id ?? null,
    channelId: read.channelId ?? null, ipAddress: req.ip ?? null, attributes: read.attributes,
  });
  if (!recorded.ok) {
    res.status(mapErrorToStatus(recorded.error)).json({ success: false, error: errorResponse(recorded.error) });
    return null;
  }
  return recorded.value;
}

/**
 * Record `read` for the signed-in caller before anything is sent. A deduped
 * read records every id the page returned that is not recorded yet (D-317),
 * so the dedupe never holds an id that was not written. Returns false when
 * the record could not be written: the request has then been answered 503
 * and the caller must send nothing more.
 */
export async function recordReadOrRefuse(req: Request, res: Response, read: AuditedRead): Promise<boolean> {
  if (req.apiKeyId !== undefined) {
    const ids = read.dedupe !== undefined && read.dedupe.idsOnlyForDedupe !== true ? { messageIds: read.dedupe.ids } : {};
    return (await recordKeyRead(req, res, read, { ...read.attributes, ...ids })) !== null;
  }
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
