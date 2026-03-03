// ===========================================
// Global Map API Hooks
// ===========================================
// TanStack Query hooks for global map key-value store CRUD.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

// ----- Types -----

export interface GlobalMapEntry {
  readonly key: string;
  readonly value: string | null;
  readonly updatedAt: string;
}

// ----- Query Keys -----

const GMAP_KEYS = {
  all: ['global-map'] as const,
  list: () => [...GMAP_KEYS.all, 'list'] as const,
} as const;

// ----- Hooks -----

export function useGlobalMap(): ReturnType<typeof useQuery<readonly GlobalMapEntry[]>> {
  return useQuery({
    queryKey: GMAP_KEYS.list(),
    queryFn: async () => {
      const result = await api.get<readonly GlobalMapEntry[]>('/global-map');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useUpsertGlobalMapEntry(): ReturnType<typeof useMutation<GlobalMapEntry, Error, { key: string; value: string }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const result = await api.put<GlobalMapEntry>(`/global-map/${encodeURIComponent(key)}`, { value });
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: GMAP_KEYS.all });
    },
  });
}

export function useDeleteGlobalMapEntry(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (key: string) => {
      const result = await api.delete<void>(`/global-map/${encodeURIComponent(key)}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: GMAP_KEYS.all });
    },
  });
}

export function useClearGlobalMap(): ReturnType<typeof useMutation<void, Error, void>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result = await api.delete<void>('/global-map');
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: GMAP_KEYS.all });
    },
  });
}
