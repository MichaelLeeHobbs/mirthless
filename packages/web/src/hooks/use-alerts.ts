// ===========================================
// Alert API Hooks
// ===========================================
// TanStack Query hooks for alert CRUD operations.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateAlertInput, UpdateAlertInput } from '@mirthless/core-models';
import { api, type AlertListResult, type AlertDetail } from '../api/client.js';

// ----- Query Keys -----

const ALERT_KEYS = {
  all: ['alerts'] as const,
  list: (page: number, pageSize: number) => [...ALERT_KEYS.all, 'list', { page, pageSize }] as const,
  detail: (id: string) => [...ALERT_KEYS.all, 'detail', id] as const,
} as const;

// ----- Query Hooks -----

export function useAlerts(
  page: number = 1,
  pageSize: number = 25,
): ReturnType<typeof useQuery<AlertListResult>> {
  return useQuery({
    queryKey: ALERT_KEYS.list(page, pageSize),
    queryFn: async () => {
      const result = await api.get<AlertListResult>(`/alerts?page=${String(page)}&pageSize=${String(pageSize)}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useAlert(
  id: string | null,
): ReturnType<typeof useQuery<AlertDetail>> {
  return useQuery({
    queryKey: ALERT_KEYS.detail(id ?? ''),
    queryFn: async () => {
      const result = await api.get<AlertDetail>(`/alerts/${id!}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: id !== null,
  });
}

// ----- Mutation Hooks -----

export function useCreateAlert(): ReturnType<typeof useMutation<AlertDetail, Error, CreateAlertInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateAlertInput) => {
      const result = await api.post<AlertDetail>('/alerts', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ALERT_KEYS.all });
    },
  });
}

export function useUpdateAlert(): ReturnType<typeof useMutation<AlertDetail, Error, { id: string; input: UpdateAlertInput }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateAlertInput }) => {
      const result = await api.put<AlertDetail>(`/alerts/${id}`, input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ALERT_KEYS.all });
    },
  });
}

export function useDeleteAlert(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.delete<void>(`/alerts/${id}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ALERT_KEYS.all });
    },
  });
}

export function useToggleAlertEnabled(): ReturnType<typeof useMutation<AlertDetail, Error, { id: string; enabled: boolean }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const result = await api.patch<AlertDetail>(`/alerts/${id}/enabled`, { enabled });
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ALERT_KEYS.all });
    },
  });
}
