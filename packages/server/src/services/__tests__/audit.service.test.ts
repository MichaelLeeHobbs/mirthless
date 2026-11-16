// ===========================================
// Audit Service Tests
// ===========================================
// The one writer of audit_log (D-312), in its three ways: in the caller's
// transaction, fail-closed, and best effort (event-emitter.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const values = vi.fn();
const txExecute = vi.fn();
const insert = vi.fn(() => ({ values }));
const tx = { execute: txExecute, insert };
const transaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
const dbInsertValues = vi.fn();
const db = { transaction, insert: vi.fn(() => ({ values: dbInsertValues })) };

vi.mock('../../lib/db.js', () => ({ db }));
const logError = vi.fn();
vi.mock('../../lib/logger.js', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: logError } }));

const { AuditService, AUDIT_WRITE_TIMEOUT_MS } = await import('../audit.service.js');

const INPUT = {
  action: 'USER_LOGIN', outcome: 'SUCCESS', userId: '3f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0c',
  ipAddress: '10.0.0.7', attributes: { username: 'kpatel' },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  values.mockResolvedValue(undefined);
  txExecute.mockResolvedValue(undefined);
  dbInsertValues.mockResolvedValue(undefined);
});

describe('AuditService.recordOrRefuse', () => {
  it('writes the row in a transaction capped by a statement timeout', async () => {
    const result = await AuditService.recordOrRefuse(INPUT);

    expect(result.ok).toBe(true);
    const timeout = new PgDialect().sqlToQuery(txExecute.mock.calls[0]![0] as SQL);
    expect(timeout.sql).toBe(`SET LOCAL statement_timeout = ${String(AUDIT_WRITE_TIMEOUT_MS)}`);
    expect(values).toHaveBeenCalledWith({
      action: 'USER_LOGIN', outcome: 'SUCCESS', userId: INPUT.userId, channelId: null,
      ipAddress: '10.0.0.7', attributes: { username: 'kpatel' },
    });
  });

  it('refuses with AUDIT_UNAVAILABLE when the row cannot be written, and logs why', async () => {
    values.mockRejectedValueOnce(new Error('canceling statement due to statement timeout'));

    const result = await AuditService.recordOrRefuse(INPUT);

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ name: 'ServiceError', code: 'AUDIT_UNAVAILABLE' });
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_LOGIN', errMsg: 'canceling statement due to statement timeout' }), expect.any(String));
  });

  it('refuses when the transaction cannot even start', async () => {
    transaction.mockRejectedValueOnce(new Error('connection refused'));

    expect((await AuditService.recordOrRefuse(INPUT)).error).toMatchObject({ code: 'AUDIT_UNAVAILABLE' });
  });
});

describe('AuditService.recordInTx', () => {
  it('writes through the caller\'s transaction, so the record commits or rolls back with the change', async () => {
    await AuditService.recordInTx(tx as never, { action: 'EVENTS_PURGED', outcome: 'SUCCESS', attributes: { olderThanDays: 30 } });

    expect(insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ action: 'EVENTS_PURGED', userId: null, ipAddress: null }));
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('AuditService.record', () => {
  it('writes one row on the shared connection', async () => {
    const result = await AuditService.record(INPUT);

    expect(result.ok).toBe(true);
    expect(dbInsertValues).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_LOGIN' }));
  });

  it('returns the failure instead of throwing', async () => {
    dbInsertValues.mockRejectedValueOnce(new Error('disk full'));

    expect((await AuditService.record(INPUT)).ok).toBe(false);
  });
});
