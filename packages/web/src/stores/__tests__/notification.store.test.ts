// ===========================================
// Notification Store Tests
// ===========================================

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useNotificationStore } from '../notification.store.js';

describe('notification store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotificationStore.setState({ notifications: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds a notification', () => {
    useNotificationStore.getState().notify('hello', 'success');
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().notifications[0]?.message).toBe('hello');
  });

  it('dedupes identical message+severity within the dedupe window', () => {
    const { notify } = useNotificationStore.getState();
    notify('dup-message', 'error');
    notify('dup-message', 'error');
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('does not dedupe different messages', () => {
    const { notify } = useNotificationStore.getState();
    notify('alpha-message', 'error');
    notify('beta-message', 'error');
    expect(useNotificationStore.getState().notifications).toHaveLength(2);
  });

  it('does not dedupe the same message at different severities', () => {
    const { notify } = useNotificationStore.getState();
    notify('sev-message', 'info');
    notify('sev-message', 'success');
    expect(useNotificationStore.getState().notifications).toHaveLength(2);
  });

  it('auto-dismisses after the timeout', () => {
    useNotificationStore.getState().notify('dismiss-message', 'info');
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
});
