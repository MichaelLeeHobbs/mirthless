// ===========================================
// Audited Read Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const recordOrRefuse = vi.fn();
vi.mock('../../services/audit.service.js', () => ({ AuditService: { recordOrRefuse } }));

const emitAuditEvent = vi.fn();
vi.mock('../event-emitter.js', () => ({ emitAuditEvent }));

const { recordReadOrRefuse, recordReadBestEffort } = await import('../audited-read.js');

function makeRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; }) as unknown as Response['status'];
  res.json = vi.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

const req = (userId: string): Request => ({ user: { id: userId }, ip: '10.0.0.7' }) as unknown as Request;
const UNAVAILABLE = { name: 'ServiceError', code: 'AUDIT_UNAVAILABLE', message: 'The audit log could not record this request' };

beforeEach(() => {
  emitAuditEvent.mockReset();
  recordOrRefuse.mockReset();
  recordOrRefuse.mockResolvedValue({ ok: true, value: undefined });
});

describe('recordReadOrRefuse', () => {
  it('records the read for the caller and lets the request go on', async () => {
    const res = makeRes();

    expect(await recordReadOrRefuse(req('u-a'), res, { action: 'ATTACHMENT_DOWNLOADED', channelId: 'c1', attributes: { messageId: 5 } })).toBe(true);

    expect(recordOrRefuse).toHaveBeenCalledWith({
      action: 'ATTACHMENT_DOWNLOADED', outcome: 'SUCCESS', userId: 'u-a', channelId: 'c1', ipAddress: '10.0.0.7', attributes: { messageId: 5 },
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers 503 AUDIT_UNAVAILABLE and stops the request when the record fails', async () => {
    recordOrRefuse.mockResolvedValueOnce({ ok: false, error: UNAVAILABLE });
    const res = makeRes();

    expect(await recordReadOrRefuse(req('u-b'), res, { action: 'MESSAGES_EXPORTED', attributes: {} })).toBe(false);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ success: false, error: { code: 'AUDIT_UNAVAILABLE', message: UNAVAILABLE.message } });
  });

  it('records every time without a dedupe key', async () => {
    for (let i = 0; i < 3; i += 1) await recordReadOrRefuse(req('u-c'), makeRes(), { action: 'ATTACHMENT_DOWNLOADED', attributes: {} });
    expect(recordOrRefuse).toHaveBeenCalledTimes(3);
  });

  it('records a deduped read once, with the ids it returned, and lets repeats through unrecorded', async () => {
    const read = { action: 'MESSAGE_CONTENT_VIEWED', channelId: 'c1', attributes: { messageId: 7 }, dedupe: { key: 'detail|c1|7', ids: [7] } };

    expect(await recordReadOrRefuse(req('u-d'), makeRes(), read)).toBe(true);
    expect(await recordReadOrRefuse(req('u-d'), makeRes(), read)).toBe(true);

    expect(recordOrRefuse).toHaveBeenCalledOnce();
    expect(recordOrRefuse.mock.calls[0]?.[0]).toMatchObject({ attributes: { messageId: 7, messageIds: [7] } });
    // Another caller reading the same message is recorded.
    await recordReadOrRefuse(req('u-e'), makeRes(), read);
    expect(recordOrRefuse).toHaveBeenCalledTimes(2);
  });

  it('does not remember a read whose record failed, so the retry is recorded', async () => {
    const read = { action: 'MESSAGE_CONTENT_VIEWED', attributes: {}, dedupe: { key: 'detail|c1|8', ids: [8] } };
    recordOrRefuse.mockResolvedValueOnce({ ok: false, error: UNAVAILABLE });

    expect(await recordReadOrRefuse(req('u-f'), makeRes(), read)).toBe(false);
    expect(await recordReadOrRefuse(req('u-f'), makeRes(), read)).toBe(true);
    expect(recordOrRefuse).toHaveBeenCalledTimes(2);
  });

  it('records every id of a 200-row page, and a repeat records only the ids it has not', async () => {
    const page = Array.from({ length: 200 }, (_, i) => i);
    const read = (ids: number[]): Parameters<typeof recordReadOrRefuse>[2] => ({ action: 'MESSAGES_SEARCHED_ALL_CHANNELS', attributes: {}, dedupe: { key: 'traffic|p1', ids } });
    await recordReadOrRefuse(req('u-g'), makeRes(), read(page));
    await recordReadOrRefuse(req('u-g'), makeRes(), read([...page.slice(1), 200]));

    const recorded = recordOrRefuse.mock.calls.map((c) => (c[0] as { attributes: { messageIds: number[] } }).attributes.messageIds);
    expect(recorded[0]).toEqual(page);
    // The new id is recorded at once, on the very next read.
    expect(recorded[1]).toEqual([200]);
  });
});

describe('recordReadBestEffort', () => {
  it('writes the record in the background, for the caller', () => {
    recordReadBestEffort(req('u-h'), { action: 'CONFIG_MAP_READ', attributes: { entries: 3 } });

    expect(emitAuditEvent).toHaveBeenCalledWith({
      action: 'CONFIG_MAP_READ', outcome: 'SUCCESS', userId: 'u-h', channelId: null, ipAddress: '10.0.0.7', attributes: { entries: 3 },
    }, expect.any(Function));
    expect(recordOrRefuse).not.toHaveBeenCalled();
  });

  it('records a repeated read once its first record was written', () => {
    emitAuditEvent.mockImplementation((_input: unknown, onWritten?: () => void) => { onWritten?.(); });
    const read = { action: 'COLLECTION_RECORDS_READ', attributes: {}, dedupe: { key: 'collection|k1', ids: ['a', 'b'] } };
    recordReadBestEffort(req('u-i'), read);
    recordReadBestEffort(req('u-i'), read);

    expect(emitAuditEvent).toHaveBeenCalledOnce();
    expect(emitAuditEvent.mock.calls[0]?.[0]).toMatchObject({ attributes: { ids: ['a', 'b'] } });
  });

  it('records the repeat when the first record was lost', () => {
    // The callback never runs: the write failed.
    const read = { action: 'COLLECTION_RECORDS_READ', attributes: {}, dedupe: { key: 'collection|k2', ids: ['a'] } };
    recordReadBestEffort(req('u-j'), read);
    recordReadBestEffort(req('u-j'), read);

    expect(emitAuditEvent).toHaveBeenCalledTimes(2);
  });

  it('keeps ids out of the record when they are for dedupe only', () => {
    recordReadBestEffort(req('u-k'), { action: 'GLOBAL_MAP_READ', attributes: { entries: 1 }, dedupe: { key: 'global-map', ids: ['mrn_12345'], idsOnlyForDedupe: true } });

    expect(emitAuditEvent.mock.calls[0]?.[0]).toMatchObject({ attributes: { entries: 1 } });
    expect(JSON.stringify(emitAuditEvent.mock.calls[0]?.[0])).not.toContain('mrn_12345');
  });
});
