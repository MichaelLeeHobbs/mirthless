// A PHI read is recorded before its content is sent, and refused with 503 when
// the record cannot be written (D-312). An API key's reads are never deduped and
// count against its daily row ceiling (D-313).

import type { Request, Response } from 'express';
import { AuditService } from '../services/audit.service.js';
import { EventService } from '../services/event.service.js';
import { AuditDedupe } from './audit-dedupe.js';
import { errorResponse, mapErrorToStatus } from './controller-helpers.js';
import { emitAuditEvent } from './event-emitter.js';
import { DEFAULT_KEY_DAILY_ROWS, KeyRowCeiling, type RowTicket } from './key-row-ceiling.js';
import { ServiceError } from './service-error.js';
import logger from './logger.js';
import { errorInfo } from '@galvanigraph/core-util';
import { AUDIT_ACTION, EVENT_NAME } from '@galvanigraph/core-models';

const dedupe = new AuditDedupe();

const keyDailyRows = ((): number => {
  const configured = Number(process.env['API_KEY_DAILY_ROWS']);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_KEY_DAILY_ROWS;
})();

const keyCeiling = new KeyRowCeiling({
  limit: keyDailyRows,
  seed: (userId, since) => AuditService.rowsReadSince(userId, since),
  seedWarned: async (userId, since) => {
    const found = await EventService.hasEventSince(EVENT_NAME.API_KEY_ROW_CEILING_WARNING, userId, since);
    if (found.ok) return found.value;
    logger.warn({ ...errorInfo(found.error) }, 'Could not read whether an API key was warned today; it may be warned again');
    return false;
  },
});

export interface AuditedRead {
  readonly action: string;
  readonly channelId?: string | null;
  /** Never message content. */
  readonly attributes: Record<string, unknown>;
  /**
   * Omit to record every time. Set `idsOnlyForDedupe` when the ids are
   * themselves PHI (global map keys) or are not ids (log lines).
   */
  readonly dedupe?: { readonly key: string; readonly ids: readonly (string | number)[]; readonly idsOnlyForDedupe?: boolean };
  /** Messages or collection records returned; counted against an API key's daily ceiling. */
  readonly rows?: number;
}

function refuse(res: Response, error: unknown): void {
  res.status(mapErrorToStatus(error)).json({ success: false, error: errorResponse(error) });
}

/** Null means the request has been answered (429 or 503). */
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
    // Fail closed: a read the audit log cannot account for is refused.
    logger.error({ ...errorInfo(err), apiKeyId: req.apiKeyId }, 'Could not read an API key\'s rows for today; refusing the read');
    refuse(res, new ServiceError('AUDIT_UNAVAILABLE', 'The audit log could not be read to count this API key\'s rows, so the read was refused. Try again, and tell an administrator if it keeps happening.'));
    return null;
  }
  if (ticket === null) {
    // A key refused from here on still gets its warning, if one is owed.
    warnNearCeiling(req, userId);
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
  warnNearCeiling(req, userId);
  return recorded.value;
}

/**
 * The 80% warning, once a day per key (#301). Not awaited: the warning is
 * advice, so the read neither waits for it nor is refused over it.
 */
function warnNearCeiling(req: Request, userId: string): void {
  const due = keyCeiling.claimWarning(userId);
  if (due === null) return;
  const apiKeyId = req.apiKeyId;
  void EventService.create({
    level: 'WARN', name: EVENT_NAME.API_KEY_ROW_CEILING_WARNING, outcome: 'SUCCESS', userId,
    channelId: null, serverId: null, ipAddress: req.ip ?? null,
    attributes: { apiKeyId, used: due.used, limit: due.limit },
  }).then((written) => {
    if (written.ok) return;
    keyCeiling.releaseWarning(userId, due);
    logger.warn({ ...errorInfo(written.error), apiKeyId }, 'Could not write an API key\'s 80% row warning; the next read tries again');
  });
}

/** `refusedRows`, not `rows`: a day's count is rebuilt from each record's `rows`. */
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
 * The request goes on whether or not the row is written (D-312). Only for
 * reads D-312 does not make fail-closed: the maps, collections, the server log,
 * unmasked secrets and Events page searches.
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
 * For collection records, which can hold PHI from many channels: a key's read
 * is counted and fail-closed (D-313). False means the request has been answered.
 */
export async function recordCountedRead(req: Request, res: Response, read: AuditedRead): Promise<boolean> {
  if (req.apiKeyId === undefined) {
    recordReadBestEffort(req, read);
    return true;
  }
  return recordReadOrRefuse(req, res, read);
}

/**
 * Never deduped; the id goes in the file's header. Null means the request has
 * been answered: send nothing more.
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
 * The dedupe remembers ids only after they are written (D-317). False means the
 * request has been answered: send nothing more.
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
