// ===========================================
// Settings API Hooks
// ===========================================
// TanStack Query hooks for system settings CRUD.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpsertSettingInput, BulkUpsertSettingsInput } from '@mirthless/core-models';
import { api, type SettingDetail } from '../api/client.js';

// ----- Query Keys -----

const SETTING_KEYS = {
  all: ['settings'] as const,
  list: (category?: string) => [...SETTING_KEYS.all, 'list', { category }] as const,
  detail: (key: string) => [...SETTING_KEYS.all, 'detail', key] as const,
} as const;

// ----- Query Hooks -----

export function useSettings(
  category?: string,
): ReturnType<typeof useQuery<readonly SettingDetail[]>> {
  return useQuery({
    queryKey: SETTING_KEYS.list(category),
    queryFn: async () => {
      const qs = category ? `?category=${encodeURIComponent(category)}` : '';
      const result = await api.get<readonly SettingDetail[]>(`/settings${qs}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useSetting(
  key: string | null,
): ReturnType<typeof useQuery<SettingDetail>> {
  return useQuery({
    queryKey: SETTING_KEYS.detail(key ?? ''),
    queryFn: async () => {
      const result = await api.get<SettingDetail>(`/settings/${encodeURIComponent(key!)}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: key !== null,
  });
}

// ----- Mutation Hooks -----

export function useUpsertSetting(): ReturnType<typeof useMutation<SettingDetail, Error, UpsertSettingInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpsertSettingInput) => {
      const result = await api.put<SettingDetail>(`/settings/${encodeURIComponent(input.key)}`, input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SETTING_KEYS.all });
    },
  });
}

export function useBulkUpsertSettings(): ReturnType<typeof useMutation<readonly SettingDetail[], Error, BulkUpsertSettingsInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: BulkUpsertSettingsInput) => {
      const result = await api.put<readonly SettingDetail[]>('/settings/bulk', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SETTING_KEYS.all });
    },
  });
}

export function useDeleteSetting(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (key: string) => {
      const result = await api.delete<void>(`/settings/${encodeURIComponent(key)}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SETTING_KEYS.all });
    },
  });
}
