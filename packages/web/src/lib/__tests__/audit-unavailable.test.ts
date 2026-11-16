import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { useNotificationStore } from '../../stores/notification.store.js';
import { AUDIT_UNAVAILABLE_NOTICE, downloadFailure, noticeAuditUnavailable } from '../audit-unavailable.js';

const messages = (): readonly string[] => useNotificationStore.getState().notifications.map((n) => n.message);

// The store drops a repeat of the same toast within 1.5 s: start each test later than that.
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
  vi.setSystemTime(Date.now() + 10_000);
  for (const n of useNotificationStore.getState().notifications) useNotificationStore.getState().dismiss(n.id);
});

describe('noticeAuditUnavailable', () => {
  it('tells the user, with the runbook, when the code is AUDIT_UNAVAILABLE', () => {
    noticeAuditUnavailable('AUDIT_UNAVAILABLE');
    expect(messages()).toContain(AUDIT_UNAVAILABLE_NOTICE);
    expect(AUDIT_UNAVAILABLE_NOTICE).toContain('docs/ops/audit-log.md');
  });

  it('says nothing for any other error', () => {
    noticeAuditUnavailable('NOT_FOUND');
    noticeAuditUnavailable(undefined);
    expect(messages()).toEqual([]);
  });
});

describe('downloadFailure', () => {
  it('returns the server message and shows the notice for AUDIT_UNAVAILABLE', async () => {
    const res = new Response(JSON.stringify({ success: false, error: { code: 'AUDIT_UNAVAILABLE', message: 'refused' } }), { status: 503 });
    expect(await downloadFailure(res)).toBe('refused');
    expect(messages()).toContain(AUDIT_UNAVAILABLE_NOTICE);
  });

  it('falls back to the status when the body is not the usual error', async () => {
    expect(await downloadFailure(new Response('oops', { status: 502 }))).toBe('Export failed with status 502');
  });
});
