// ===========================================
// Configuration Map API Hooks
// ===========================================
// TanStack Query hooks for categorized configuration map CRUD.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

// ----- Types -----

export interface ConfigMapEntry {
  readonly category: string;
  readonly name: string;
  readonly value: string | null;
}

// ----- Query Keys -----

const CMAP_KEYS = {
  all: ['config-map'] as const,
  list: (category?: string) => [...CMAP_KEYS.all, 'list', category ?? 'all'] as const,
} as const;

// ----- Hooks -----

export function useConfigMap(category?: string): ReturnType<typeof useQuery<readonly ConfigMapEntry[]>> {
  return useQuery({
    queryKey: CMAP_KEYS.list(category),
    queryFn: async () => {
      const params = category ? `?category=${encodeURIComponent(category)}` : '';
      const result = await api.get<readonly ConfigMapEntry[]>(`/config-map${params}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useUpsertConfigMapEntry(): ReturnType<typeof useMutation<ConfigMapEntry, Error, { category: string; name: string; value: string }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ category, name, value }: { category: string; name: string; value: string }) => {
      const result = await api.put<ConfigMapEntry>(
        `/config-map/${encodeURIComponent(category)}/${encodeURIComponent(name)}`,
        { value },
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CMAP_KEYS.all });
    },
  });
}

export function useDeleteConfigMapEntry(): ReturnType<typeof useMutation<void, Error, { category: string; name: string }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ category, name }: { category: string; name: string }) => {
      const result = await api.delete<void>(
        `/config-map/${encodeURIComponent(category)}/${encodeURIComponent(name)}`,
      );
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CMAP_KEYS.all });
    },
  });
}
