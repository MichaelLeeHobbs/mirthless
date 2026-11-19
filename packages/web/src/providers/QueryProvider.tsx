import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useNotificationStore } from '../stores/notification.store.js';
import { errorMessage } from '../lib/error-message.js';

const MUTATION_ERROR_FALLBACK = 'An unexpected error occurred';

// A failed save, toggle or delete must never be silent, even where the call
// site forgot an onError handler.
const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation) => {
    // Respect an explicit opt-out or a call site that already notifies.
    if (mutation.options.onError) return;
    useNotificationStore.getState().notify(errorMessage(error, MUTATION_ERROR_FALLBACK), 'error');
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
