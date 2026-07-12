import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useNotificationStore } from '../stores/notification.store.js';

/** Extract a human-readable message from an unknown mutation error. */
export function mutationErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return 'An unexpected error occurred';
}

// Global safety net: any mutation that rejects surfaces an error toast, even if
// the call site forgot an onError handler. This upholds "fail loudly" — a failed
// save/toggle/delete must never be silent. Per-call onError still runs and can
// add context; this only guarantees the user is told something went wrong.
const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation) => {
    // Respect an explicit opt-out or a call site that already notifies.
    if (mutation.options.onError) return;
    useNotificationStore.getState().notify(mutationErrorMessage(error), 'error');
  },
});

export const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

interface QueryProviderProps {
  readonly children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps): ReactNode {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
