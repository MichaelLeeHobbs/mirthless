// ===========================================
// User Preferences API Hooks
// ===========================================
// TanStack Query hooks for user preference CRUD.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

// ----- Types -----

export interface UserPreferenceEntry {
  readonly key: string;
  readonly value: string | null;
}

// ----- Query Keys -----

const PREF_KEYS = {
  all: ['preferences'] as const,
  list: () => [...PREF_KEYS.all, 'list'] as const,
  detail: (key: string) => [...PREF_KEYS.all, 'detail', key] as const,
} as const;

// ----- Hooks -----

export function usePreferences(): ReturnType<typeof useQuery<readonly UserPreferenceEntry[]>> {
  return useQuery({
    queryKey: PREF_KEYS.list(),
    queryFn: async () => {
      const result = await api.get<readonly UserPreferenceEntry[]>('/users/me/preferences');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useUpsertPreference(): ReturnType<typeof useMutation<UserPreferenceEntry, Error, { key: string; value: string | null }>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }) => {
      const result = await api.put<UserPreferenceEntry>('/users/me/preferences', { key, value });
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PREF_KEYS.all });
    },
  });
}

export function useDeletePreference(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const result = await api.delete<void>(`/users/me/preferences/${encodeURIComponent(key)}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PREF_KEYS.all });
    },
  });
}
