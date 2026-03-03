// ===========================================
// Tag API Hooks
// ===========================================
// TanStack Query hooks for channel tag CRUD + assignment.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateTagInput, UpdateTagInput } from '@mirthless/core-models';
import { api } from '../api/client.js';

// ----- Types -----

export interface TagSummary {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
  readonly assignmentCount: number;
}

// ----- Query Keys -----

const TAG_KEYS = {
  all: ['tags'] as const,
  list: () => [...TAG_KEYS.all, 'list'] as const,
} as const;

// ----- Hooks -----

export function useTags(): ReturnType<typeof useQuery<readonly TagSummary[]>> {
  return useQuery({
    queryKey: TAG_KEYS.list(),
    queryFn: async () => {
      const result = await api.get<readonly TagSummary[]>('/tags');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useCreateTag(): ReturnType<typeof useMutation<TagSummary, Error, CreateTagInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTagInput) => {
      const result = await api.post<TagSummary>('/tags', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TAG_KEYS.all });
    },
  });
}

export function useUpdateTag(): ReturnType<typeof useMutation<TagSummary, Error, { id: string; input: UpdateTagInput }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateTagInput }) => {
      const result = await api.put<TagSummary>(`/tags/${id}`, input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TAG_KEYS.all });
    },
  });
}

export function useDeleteTag(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.delete<void>(`/tags/${id}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TAG_KEYS.all });
    },
  });
}

export function useAssignTag(): ReturnType<typeof useMutation<void, Error, { tagId: string; channelId: string }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ tagId, channelId }: { tagId: string; channelId: string }) => {
      const result = await api.post<void>(`/tags/${tagId}/channels`, { channelId });
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TAG_KEYS.all });
    },
  });
}

export function useUnassignTag(): ReturnType<typeof useMutation<void, Error, { tagId: string; channelId: string }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ tagId, channelId }: { tagId: string; channelId: string }) => {
      const result = await api.delete<void>(`/tags/${tagId}/channels/${channelId}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TAG_KEYS.all });
    },
  });
}
