// ===========================================
// Audit Service
// ===========================================
// The one writer and reader of audit_log, the protected audit record (D-312).
// Three ways to write, by what a lost record would cost:
// - recordInTx: in the caller's transaction, so a change and its record
//   commit or roll back together (grant changes, later epics).
// - recordOrRefuse: fail-closed. The caller refuses its request with 503
//   AUDIT_UNAVAILABLE when the record cannot be written (PHI reads, purges).
// - record: one row, the failure returned; emitAuditEvent in
//   lib/event-emitter.ts calls it best effort (sign-ins, refusals).

import { tryCatch, type Result } from 'stderr-lib';
import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { AuditListQuery } from '@galvanigraph/core-models';
import { errorInfo } from '@galvanigraph/core-util';
import { db } from '../lib/db.js';
import logger from '../lib/logger.js';
import { ServiceError } from '../lib/service-error.js';
import { auditLog } from '../db/schema/index.js';

/** How long a fail-closed audit write may take before the request is refused. */
export const AUDIT_WRITE_TIMEOUT_MS = 2000;

/** One audit row. Never put message content, a token or a secret in `attributes`. */
export interface AuditRecordInput {
  readonly action: string;
  readonly outcome: 'SUCCESS' | 'FAILURE';
  readonly userId?: string | null;
  readonly channelId?: string | null;
  readonly ipAddress?: string | null;
  readonly attributes?: Record<string, unknown> | null;
}

export interface AuditEntry {
  readonly id: number;
  readonly occurredAt: Date;
  readonly action: string;
  readonly outcome: string;
  readonly userId: string | null;
  readonly channelId: string | null;
  readonly ipAddress: string | null;
  readonly attributes: Record<string, unknown> | null;
}

export interface AuditListResult {
  readonly data: readonly AuditEntry[];
  readonly pagination: { readonly page: number; readonly pageSize: number; readonly total: number; readonly totalPages: number };
}

/** What can insert an audit row: the shared db or a transaction on it. */
type AuditWriter = Pick<typeof db, 'insert'>;

/** The transaction a recordInTx caller passes. */
export type AuditTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Insert one row and return its id. */
async function insertRow(writer: AuditWriter, input: AuditRecordInput): Promise<number> {
  const [row] = await writer.insert(auditLog).values({
    action: input.action,
    outcome: input.outcome,
    userId: input.userId ?? null,
    channelId: input.channelId ?? null,
    ipAddress: input.ipAddress ?? null,
    attributes: input.attributes ?? null,
  }).returning({ id: auditLog.id });
  if (!row) throw new Error('The audit insert returned no row');
  return row.id;
}

function whereFor(query: AuditListQuery): ReturnType<typeof and> {
  const conditions = [];
  if (query.action !== undefined) conditions.push(inArray(auditLog.action, query.action.split(',').map((s) => s.trim())));
  if (query.outcome !== undefined) conditions.push(eq(auditLog.outcome, query.outcome));
  if (query.userId !== undefined) conditions.push(eq(auditLog.userId, query.userId));
  if (query.channelId !== undefined) conditions.push(eq(auditLog.channelId, query.channelId));
  if (query.startDate !== undefined) conditions.push(gte(auditLog.occurredAt, new Date(query.startDate)));
  if (query.endDate !== undefined) conditions.push(lte(auditLog.occurredAt, new Date(query.endDate)));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export class AuditService {
  /** Write one row on the shared connection. */
  static async record(input: AuditRecordInput): Promise<Result<void>> {
    return tryCatch(async () => { await insertRow(db, input); });
  }

  /** Write one row in the caller's transaction. Throws with it, so the change rolls back. */
  static async recordInTx(tx: AuditTransaction, input: AuditRecordInput): Promise<void> {
    await insertRow(tx, input);
  }

  /**
   * Write one row and return its id, or fail with AUDIT_UNAVAILABLE (503) so
   * the caller refuses its request. The write may take AUDIT_WRITE_TIMEOUT_MS.
   */
  static async recordOrRefuse(input: AuditRecordInput): Promise<Result<number>> {
    return tryCatch(async () => {
      // statement_timeout bounds the INSERT on the server; the race bounds the
      // wait for a pool connection and a link that goes silent. A write that
      // lands after the race is lost only to the caller: its row still commits.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(`Audit write took longer than ${String(AUDIT_WRITE_TIMEOUT_MS)} ms`)); }, AUDIT_WRITE_TIMEOUT_MS);
      });
      const written = await tryCatch(async () => {
        const write = db.transaction(async (tx) => {
          await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${String(AUDIT_WRITE_TIMEOUT_MS)}`));
          return insertRow(tx, input);
        });
        // When the timer wins, the write may still fail later; nothing awaits it then.
        void write.catch(() => undefined);
        try {
          return await Promise.race([write, timedOut]);
        } finally {
          clearTimeout(timer);
        }
      });
      if (!written.ok) {
        logger.error({ ...errorInfo(written.error), action: input.action }, 'Audit record failed; refusing the request');
        throw new ServiceError('AUDIT_UNAVAILABLE', 'The audit log could not record this request, so it was refused. Try again, and tell an administrator if it keeps happening.');
      }
      return written.value;
    });
  }

  /** List audit rows, newest first. */
  static async list(query: AuditListQuery): Promise<Result<AuditListResult>> {
    return tryCatch(async () => {
      const where = whereFor(query);
      const [totalRow] = await db.select({ value: count() }).from(auditLog).where(where);
      const total = totalRow?.value ?? 0;
      const data = await db.select().from(auditLog).where(where)
        .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
      return { data, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
    });
  }

  /** One audit row by id. */
  static async getById(id: number): Promise<Result<AuditEntry>> {
    return tryCatch(async () => {
      const [row] = await db.select().from(auditLog).where(eq(auditLog.id, id)).limit(1);
      if (!row) throw new ServiceError('NOT_FOUND', `Audit record ${String(id)} not found`);
      return row;
    });
  }
}
