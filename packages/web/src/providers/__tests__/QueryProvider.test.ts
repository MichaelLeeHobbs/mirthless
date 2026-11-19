import { describe, it, expect, beforeEach } from 'vitest';
import { MutationObserver } from '@tanstack/react-query';
import { queryClient } from '../QueryProvider.js';
import { useNotificationStore } from '../../stores/notification.store.js';

async function toastTextFor(rejection: unknown): Promise<ReadonlyArray<string>> {
  const observer = new MutationObserver(queryClient, {
    mutationFn: (): Promise<never> => Promise.reject(rejection),
  });
  await observer.mutate().catch(() => { /* expected rejection */ });
  return useNotificationStore.getState().notifications
    .filter((n) => n.severity === 'error')
    .map((n) => n.message);
}

describe('global MutationCache onError', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
  });

  it('toasts a rejected string as-is', async () => {
    expect(await toastTextFor('nope')).toEqual(['nope']);
  });

  it('toasts the fallback text when the Error message is empty', async () => {
    expect(await toastTextFor(new Error(''))).toEqual(['An unexpected error occurred']);
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
