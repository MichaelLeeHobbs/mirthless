// ===========================================
// Collection API Hooks
// ===========================================
// TanStack Query hooks for collection CRUD + record browsing.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateCollectionInput, UpdateCollectionInput } from '@mirthless/core-models';
import { api } from '../api/client.js';

// ----- Types -----

export interface CollectionSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly indexedFields: readonly string[];
  readonly defaultTtlSeconds: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CollectionRecord {
  readonly id: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly payload: string | null;
  readonly expireAt: string | null;
  readonly createdAt: string;
}

// ----- Query Keys -----

const COL_KEYS = {
  all: ['collections'] as const,
  list: () => [...COL_KEYS.all, 'list'] as const,
  detail: (id: string) => [...COL_KEYS.all, 'detail', id] as const,
  records: (id: string) => [...COL_KEYS.all, 'records', id] as const,
} as const;

// ----- Hooks -----

export function useCollections(): ReturnType<typeof useQuery<readonly CollectionSummary[]>> {
  return useQuery({
    queryKey: COL_KEYS.list(),
    queryFn: async () => {
      const result = await api.get<readonly CollectionSummary[]>('/collections');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useCollectionRecords(id: string): ReturnType<typeof useQuery<readonly CollectionRecord[]>> {
  return useQuery({
    queryKey: COL_KEYS.records(id),
    queryFn: async () => {
      const result = await api.get<readonly CollectionRecord[]>(`/collections/${id}/records`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: id.length > 0,
  });
}

export function useCreateCollection(): ReturnType<typeof useMutation<CollectionSummary, Error, CreateCollectionInput>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCollectionInput) => {
      const result = await api.post<CollectionSummary>('/collections', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: COL_KEYS.all });
    },
  });
}

export function useUpdateCollection(): ReturnType<typeof useMutation<CollectionSummary, Error, { id: string; input: UpdateCollectionInput }>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateCollectionInput }) => {
      const result = await api.put<CollectionSummary>(`/collections/${id}`, input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: COL_KEYS.all });
    },
  });
}

export function useDeleteCollection(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.delete<void>(`/collections/${id}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: COL_KEYS.all });
    },
  });
}
