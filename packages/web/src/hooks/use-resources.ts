// ===========================================
// Resource API Hooks
// ===========================================
// TanStack Query hooks for resource CRUD.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateResourceInput, UpdateResourceInput } from '@mirthless/core-models';
import { api } from '../api/client.js';

// ----- Types -----

export interface ResourceSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResourceDetail extends ResourceSummary {
  readonly content: string | null;
}

// ----- Query Keys -----

const RES_KEYS = {
  all: ['resources'] as const,
  list: () => [...RES_KEYS.all, 'list'] as const,
  detail: (id: string) => [...RES_KEYS.all, 'detail', id] as const,
} as const;

// ----- Hooks -----

export function useResources(): ReturnType<typeof useQuery<readonly ResourceSummary[]>> {
  return useQuery({
    queryKey: RES_KEYS.list(),
    queryFn: async () => {
      const result = await api.get<readonly ResourceSummary[]>('/resources');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useResource(id: string): ReturnType<typeof useQuery<ResourceDetail>> {
  return useQuery({
    queryKey: RES_KEYS.detail(id),
    queryFn: async () => {
      const result = await api.get<ResourceDetail>(`/resources/${id}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: id.length > 0,
  });
}

export function useCreateResource(): ReturnType<typeof useMutation<ResourceDetail, Error, CreateResourceInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateResourceInput) => {
      const result = await api.post<ResourceDetail>('/resources', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: RES_KEYS.all });
    },
  });
}

export function useUpdateResource(): ReturnType<typeof useMutation<ResourceDetail, Error, { id: string; input: UpdateResourceInput }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateResourceInput }) => {
      const result = await api.put<ResourceDetail>(`/resources/${id}`, input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: RES_KEYS.all });
    },
  });
}

export function useDeleteResource(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.delete<void>(`/resources/${id}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: RES_KEYS.all });
    },
  });
}
