import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const recordOrRefuse = vi.fn();
// Seeds a key's count for today; the ceiling is 5000.
const rowsReadSince = vi.fn(async (userId: string) => {
  if (userId === 'key-unreadable') throw new Error('audit_log unreadable');
  return userId === 'key-near' ? 4998 : 0;
});
vi.mock('../../services/audit.service.js', () => ({ AuditService: { recordOrRefuse, rowsReadSince } }));
// The 80% warning (#301) is an events row: the read-back and the write.
const createEvent = vi.fn().mockResolvedValue({ ok: true, value: {} });
const hasEventSince = vi.fn().mockResolvedValue({ ok: true, value: false });
vi.mock('../../services/event.service.js', () => ({ EventService: { create: createEvent, hasEventSince } }));

vi.mock('../logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const emitAuditEvent = vi.fn();
vi.mock('../event-emitter.js', () => ({ emitAuditEvent }));

const { recordReadOrRefuse, recordReadBestEffort, recordExportOrRefuse, recordCountedRead } = await import('../audited-read.js');

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
  createEvent.mockClear();
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
    expect(recorded[1]).toEqual([200]);
  });
});

describe('recordExportOrRefuse', () => {
  it('records the export every time and returns the audit row id for the file header', async () => {
    recordOrRefuse.mockResolvedValue({ ok: true, value: 77 });
    const read = { action: 'MESSAGES_EXPORTED', channelId: 'c1', attributes: { reason: 'Review' } };

    expect(await recordExportOrRefuse(req('u-x'), makeRes(), read)).toBe(77);
    expect(await recordExportOrRefuse(req('u-x'), makeRes(), read)).toBe(77);
    expect(recordOrRefuse).toHaveBeenCalledTimes(2);
  });

  it('answers 503 and returns null when the export cannot be recorded', async () => {
    recordOrRefuse.mockResolvedValueOnce({ ok: false, error: UNAVAILABLE });
    const res = makeRes();

    expect(await recordExportOrRefuse(req('u-y'), res, { action: 'MESSAGES_EXPORTED', attributes: {} })).toBeNull();
    expect(res.statusCode).toBe(503);
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

describe('reads made with an API key (D-313)', () => {
  const keyReq = (userId: string): Request => ({ user: { id: userId }, apiKeyId: `k-${userId}`, ip: '10.0.0.8' }) as unknown as Request;
  const search = { action: 'MESSAGE_SEARCHED', channelId: 'c1', attributes: { total: 2 }, dedupe: { key: 'search|c1|x', ids: [1, 2] }, rows: 2 };

  it('records every read with its rows and the ids it returned, never deduped', async () => {
    for (let i = 0; i < 2; i += 1) expect(await recordReadOrRefuse(keyReq('key-a'), makeRes(), search)).toBe(true);
    expect(recordOrRefuse).toHaveBeenCalledTimes(2);
    expect(recordOrRefuse).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'MESSAGE_SEARCHED', userId: 'key-a', attributes: { total: 2, messageIds: [1, 2], rows: 2 },
    }));
  });

  it('refuses with 429 the read that would pass the day\'s ceiling, records that once, and sends nothing', async () => {
    const first = makeRes();
    expect(await recordReadOrRefuse(keyReq('key-near'), first, { ...search, rows: 2 })).toBe(true);
    const over = makeRes();
    expect(await recordReadOrRefuse(keyReq('key-near'), over, { ...search, rows: 1 })).toBe(false);
    expect(over.statusCode).toBe(429);
    expect(await recordReadOrRefuse(keyReq('key-near'), makeRes(), { ...search, rows: 1 })).toBe(false);
    const ceilingRecords = recordOrRefuse.mock.calls.filter(([r]) => (r as { action: string }).action === 'API_KEY_ROW_CEILING_REACHED');
    expect(ceilingRecords).toHaveLength(1);
    expect(ceilingRecords[0]![0]).toMatchObject({ attributes: { apiKeyId: 'k-key-near', limit: 5000, refusedRows: 1 } });
    expect((ceilingRecords[0]![0] as { attributes: Record<string, unknown> }).attributes).not.toHaveProperty('rows');
  });

  it('gives the rows back when the record fails, so the refused read does not use the day up', async () => {
    recordOrRefuse.mockResolvedValueOnce({ ok: false, error: UNAVAILABLE });
    const failed = makeRes();
    expect(await recordExportOrRefuse(keyReq('key-b'), failed, { action: 'MESSAGES_EXPORTED', attributes: {}, rows: 5000 })).toBeNull();
    expect(failed.statusCode).toBe(503);
    recordOrRefuse.mockResolvedValueOnce({ ok: true, value: 41 });
    expect(await recordExportOrRefuse(keyReq('key-b'), makeRes(), { action: 'MESSAGES_EXPORTED', attributes: {}, rows: 5000 })).toBe(41);
  });

  it('refuses with a logged 503 when today\'s count cannot be read, and records nothing', async () => {
    const res = makeRes();
    expect(await recordReadOrRefuse(keyReq('key-unreadable'), res, search)).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: { code: 'AUDIT_UNAVAILABLE' } });
    expect(recordOrRefuse).not.toHaveBeenCalled();
  });

  it('tries the ceiling record again when it could not be written', async () => {
    // key-near starts at 4998 of 5000: two rows fit, the next read is refused.
    expect(await recordReadOrRefuse(keyReq('key-near2'), makeRes(), { ...search, rows: 5000 })).toBe(true);
    recordOrRefuse.mockResolvedValueOnce({ ok: false, error: UNAVAILABLE });
    expect(await recordReadOrRefuse(keyReq('key-near2'), makeRes(), { ...search, rows: 1 })).toBe(false);
    expect(await recordReadOrRefuse(keyReq('key-near2'), makeRes(), { ...search, rows: 1 })).toBe(false);
    const attempts = recordOrRefuse.mock.calls.filter(([r]) => (r as { action: string }).action === 'API_KEY_ROW_CEILING_REACHED');
    expect(attempts).toHaveLength(2);
  });

  it('says so when one read is bigger than a whole day\'s ceiling', async () => {
    const res = makeRes();
    expect(await recordExportOrRefuse(keyReq('key-big'), res, { action: 'MESSAGES_EXPORTED', attributes: {}, rows: 6000 })).toBeNull();
    expect(res.statusCode).toBe(429);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/6000 rows, more than an API key may read in a day/);
  });

  it('counts collection records against the same ceiling, fail-closed, for a key', async () => {
    const read = { action: 'COLLECTION_RECORDS_READ', attributes: { collectionId: 'c1' }, dedupe: { key: 'collection|c1|{}', ids: ['r1', 'r2'] }, rows: 2 };
    expect(await recordCountedRead(keyReq('key-near3'), makeRes(), read)).toBe(true);
    expect(recordOrRefuse).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'COLLECTION_RECORDS_READ', attributes: expect.objectContaining({ rows: 2 }) }));
    const over = makeRes();
    expect(await recordCountedRead(keyReq('key-near3'), over, { ...read, rows: 4999 })).toBe(false);
    expect(over.statusCode).toBe(429);
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('keeps a person\'s collection read best effort and uncounted', async () => {
    const read = { action: 'COLLECTION_RECORDS_READ', attributes: { collectionId: 'c1' }, rows: 2 };
    expect(await recordCountedRead(req('person-a'), makeRes(), read)).toBe(true);
    expect(recordOrRefuse).not.toHaveBeenCalled();
    expect(emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'COLLECTION_RECORDS_READ', attributes: { collectionId: 'c1' } }), expect.any(Function));
  });

  it('counts nothing for a read that returns no message rows', async () => {
    expect(await recordExportOrRefuse(keyReq('key-c'), makeRes(), { action: 'EVENTS_EXPORTED', attributes: { reason: 'r' } })).not.toBeNull();
    expect(recordOrRefuse).toHaveBeenLastCalledWith(expect.objectContaining({ attributes: { reason: 'r' } }));
  });
});

describe('the 80% warning for an API key (#301)', () => {
  // The warning is written beside the response; let its write settle.
  const settle = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });
  const keyReq = (userId: string): Request => ({ user: { id: userId }, apiKeyId: `k-${userId}`, ip: '10.0.0.9' }) as unknown as Request;
  const read = (rows: number): Parameters<typeof recordReadOrRefuse>[2] => ({ action: 'MESSAGE_SEARCHED', channelId: 'c1', attributes: {}, rows });

  it('writes one WARN event when a key\'s count first reaches 80% of the ceiling, naming the key, its count and the ceiling', async () => {
    expect(await recordReadOrRefuse(keyReq('warn-a'), makeRes(), read(3999))).toBe(true);
    expect(createEvent).not.toHaveBeenCalled();
    expect(await recordReadOrRefuse(keyReq('warn-a'), makeRes(), read(1))).toBe(true);
    expect(createEvent).toHaveBeenCalledOnce();
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: 'WARN', name: 'API_KEY_ROW_CEILING_WARNING', userId: 'warn-a',
      attributes: { apiKeyId: 'k-warn-a', used: 4000, limit: 5000 },
    }));
    await recordReadOrRefuse(keyReq('warn-a'), makeRes(), read(10));
    expect(createEvent).toHaveBeenCalledOnce();
  });

  it('tries the warning again on the next read when the write failed', async () => {
    createEvent.mockResolvedValueOnce({ ok: false, error: new Error('db down') });
    await recordReadOrRefuse(keyReq('warn-b'), makeRes(), read(4500));
    await settle();
    await recordReadOrRefuse(keyReq('warn-b'), makeRes(), read(1));
    expect(createEvent).toHaveBeenCalledTimes(2);
    expect(createEvent).toHaveBeenLastCalledWith(expect.objectContaining({ attributes: expect.objectContaining({ used: 4501 }) }));
  });

  it('does not warn again on a day the events table says it already warned', async () => {
    hasEventSince.mockResolvedValueOnce({ ok: true, value: true });
    await recordReadOrRefuse(keyReq('warn-d'), makeRes(), read(4500));
    expect(createEvent).not.toHaveBeenCalled();
    expect(hasEventSince).toHaveBeenLastCalledWith('API_KEY_ROW_CEILING_WARNING', 'warn-d', expect.any(Date));
  });

  it('lets the read through and warns when the events table cannot be read', async () => {
    hasEventSince.mockResolvedValueOnce({ ok: false, error: new Error('db down') });
    expect(await recordReadOrRefuse(keyReq('warn-e'), makeRes(), read(4500))).toBe(true);
    expect(createEvent).toHaveBeenCalledOnce();
  });

  it('still warns a key whose every read after a failed write is refused at the ceiling', async () => {
    createEvent.mockResolvedValueOnce({ ok: false, error: new Error('db down') });
    expect(await recordReadOrRefuse(keyReq('warn-f'), makeRes(), read(5000))).toBe(true);
    await settle();
    const res = makeRes();
    expect(await recordReadOrRefuse(keyReq('warn-f'), res, read(1))).toBe(false);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(createEvent).toHaveBeenCalledTimes(2);
    expect(createEvent).toHaveBeenLastCalledWith(expect.objectContaining({ attributes: { apiKeyId: 'k-warn-f', used: 5000, limit: 5000 } }));
  });

  it('never warns for a read that was not recorded, nor for a person', async () => {
    recordOrRefuse.mockResolvedValueOnce({ ok: false, error: UNAVAILABLE });
    await recordReadOrRefuse(keyReq('warn-c'), makeRes(), read(4500));
    await recordReadOrRefuse(req('person-w'), makeRes(), read(4500));
    expect(createEvent).not.toHaveBeenCalled();
  });
});
