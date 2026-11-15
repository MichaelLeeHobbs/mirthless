// ===========================================
// Event API Hooks
// ===========================================
// TanStack Query hooks for event (audit log) operations.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type EventListResult, type EventDetail } from '../api/client.js';
import { definedSearchParams } from '../lib/search-params.js';

// ----- Query Keys -----

const EVENT_KEYS = {
  all: ['events'] as const,
  list: (params: Record<string, unknown>) => [...EVENT_KEYS.all, 'list', params] as const,
  detail: (id: number) => [...EVENT_KEYS.all, 'detail', id] as const,
} as const;

// ----- Query Hooks -----

export interface EventListParams {
  readonly page?: number;
  readonly pageSize?: number;
  readonly level?: string;
  readonly name?: string;
  readonly outcome?: string;
  readonly userId?: string;
  readonly channelId?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}

/** The `?...` suffix for the event list, or '' when nothing is set. Exported for testing. */
export function buildEventQueryString(params: EventListParams): string {
  const qs = definedSearchParams({
    page: params.page,
    pageSize: params.pageSize,
    level: params.level,
    name: params.name,
    outcome: params.outcome,
    userId: params.userId,
    channelId: params.channelId,
    startDate: params.startDate,
    endDate: params.endDate,
  }).toString();
  return qs ? `?${qs}` : '';
}

export function useEvents(
  params: EventListParams = {},
): ReturnType<typeof useQuery<EventListResult>> {
  return useQuery({
    queryKey: EVENT_KEYS.list(params as Record<string, unknown>),
    queryFn: async () => {
      const qs = buildEventQueryString(params);
      const result = await api.get<EventListResult>(`/events${qs}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useEvent(
  id: number | null,
): ReturnType<typeof useQuery<EventDetail>> {
  return useQuery({
    queryKey: EVENT_KEYS.detail(id ?? 0),
    queryFn: async () => {
      const result = await api.get<EventDetail>(`/events/${String(id!)}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: id !== null,
  });
}

// ----- Mutation Hooks -----

export function usePurgeEvents(): ReturnType<typeof useMutation<{ deleted: number }, Error, number>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (olderThanDays: number) => {
      const result = await api.delete<{ deleted: number }>(`/events?olderThanDays=${String(olderThanDays)}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: EVENT_KEYS.all });
    },
  });
}
