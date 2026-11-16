// ===========================================
// Event Emitter Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn().mockResolvedValue({ ok: true, value: undefined });
vi.mock('../../services/event.service.js', () => ({ EventService: { create } }));
const record = vi.fn().mockResolvedValue({ ok: true, value: undefined });
vi.mock('../../services/audit.service.js', () => ({ AuditService: { record } }));
const warn = vi.fn();
vi.mock('../logger.js', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } }));

const { emitSuccessEvent, emitAuditEvent, lostAuditRecordCount } = await import('../event-emitter.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('emitSuccessEvent', () => {
  it('records an INFO / SUCCESS event with the caller from the audit context', () => {
    emitSuccessEvent('THING_UPDATED', { userId: 'user-1', ipAddress: '192.0.2.1' }, { action: 'create' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toStrictEqual({
      level: 'INFO', name: 'THING_UPDATED', outcome: 'SUCCESS',
      userId: 'user-1', channelId: null, serverId: null, ipAddress: '192.0.2.1',
      attributes: { action: 'create' },
    });
  });

  it('records null user and address when there is no audit context', () => {
    emitSuccessEvent('THING_UPDATED', undefined, { action: 'delete' });

    expect(create.mock.calls[0]?.[0]).toStrictEqual({
      level: 'INFO', name: 'THING_UPDATED', outcome: 'SUCCESS',
      userId: null, channelId: null, serverId: null, ipAddress: null,
      attributes: { action: 'delete' },
    });
  });

  it('records null for context fields that are absent or null', () => {
    emitSuccessEvent('THING_UPDATED', { userId: null }, {});

    expect(create.mock.calls[0]?.[0]).toMatchObject({ userId: null, ipAddress: null });
  });
});

describe('emitAuditEvent', () => {
  it('writes the row to the audit log, not the events table', async () => {
    emitAuditEvent({ action: 'USER_LOGIN', outcome: 'SUCCESS', userId: 'user-1' });
    await vi.waitFor(() => { expect(record).toHaveBeenCalledOnce(); });

    expect(record).toHaveBeenCalledWith({ action: 'USER_LOGIN', outcome: 'SUCCESS', userId: 'user-1' });
    expect(create).not.toHaveBeenCalled();
  });

  it('counts each lost record, for system info', async () => {
    const before = lostAuditRecordCount();
    record.mockResolvedValueOnce({ ok: false, error: new Error('disk full') });
    record.mockRejectedValueOnce(new Error('pool closed'));
    emitAuditEvent({ action: 'USER_LOGOUT', outcome: 'SUCCESS' });
    emitAuditEvent({ action: 'USER_LOGOUT', outcome: 'SUCCESS' });
    emitAuditEvent({ action: 'USER_LOGOUT', outcome: 'SUCCESS' });

    await vi.waitFor(() => { expect(lostAuditRecordCount()).toBe(before + 2); });
  });

  it('logs a failed write at WARN and never throws to the caller', async () => {
    record.mockResolvedValueOnce({ ok: false, error: new Error('disk full') });
    expect(() => { emitAuditEvent({ action: 'USER_LOGOUT', outcome: 'SUCCESS' }); }).not.toThrow();
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith({ errMsg: 'disk full', action: 'USER_LOGOUT' }, 'Failed to write audit record'); });

    record.mockRejectedValueOnce(new Error('pool closed'));
    emitAuditEvent({ action: 'USER_LOGOUT', outcome: 'SUCCESS' });
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith({ errMsg: 'pool closed', action: 'USER_LOGOUT' }, 'Failed to write audit record'); });
  });
});
