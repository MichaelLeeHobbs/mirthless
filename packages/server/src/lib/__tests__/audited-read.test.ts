// ===========================================
// Audited Read Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const recordOrRefuse = vi.fn();
vi.mock('../../services/audit.service.js', () => ({ AuditService: { recordOrRefuse } }));

const { recordReadOrRefuse } = await import('../audited-read.js');

function makeRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; }) as unknown as Response['status'];
  res.json = vi.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

const req = (userId: string): Request => ({ user: { id: userId }, ip: '10.0.0.7' }) as unknown as Request;
const UNAVAILABLE = { name: 'ServiceError', code: 'AUDIT_UNAVAILABLE', message: 'The audit log could not record this request' };

beforeEach(() => {
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

  it('lists at most 100 message ids in one record', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => i);
    await recordReadOrRefuse(req('u-g'), makeRes(), { action: 'MESSAGE_SEARCHED', attributes: { total: 150 }, dedupe: { key: 'search|c1|p1', ids } });

    const attrs = (recordOrRefuse.mock.calls[0]?.[0] as { attributes: { messageIds: number[] } }).attributes;
    expect(attrs.messageIds).toHaveLength(100);
  });
});
