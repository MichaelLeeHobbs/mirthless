// ===========================================
// QueryProvider Global Mutation Error Handler Tests
// ===========================================

import { describe, it, expect, beforeEach } from 'vitest';
import { MutationObserver } from '@tanstack/react-query';
import { queryClient, mutationErrorMessage } from '../QueryProvider.js';
import { useNotificationStore } from '../../stores/notification.store.js';

describe('mutationErrorMessage', () => {
  it('extracts message from an Error', () => {
    expect(mutationErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('uses a non-empty string as-is', () => {
    expect(mutationErrorMessage('nope')).toBe('nope');
  });

  it('falls back for unknown/empty values', () => {
    expect(mutationErrorMessage(new Error(''))).toBe('An unexpected error occurred');
    expect(mutationErrorMessage(null)).toBe('An unexpected error occurred');
    expect(mutationErrorMessage({})).toBe('An unexpected error occurred');
  });
});

describe('global MutationCache onError', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
  });

  it('surfaces an error toast for a mutation with no onError handler', async () => {
    const observer = new MutationObserver(queryClient, {
      mutationFn: (): Promise<never> => Promise.reject(new Error('mutation failed')),
    });

    await observer.mutate().catch(() => { /* expected rejection */ });

    const notes = useNotificationStore.getState().notifications;
    expect(notes.some((n) => n.severity === 'error' && n.message === 'mutation failed')).toBe(true);
  });
});
