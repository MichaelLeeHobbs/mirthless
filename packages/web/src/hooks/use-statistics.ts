// ===========================================
// Statistics API Hooks
// ===========================================
// TanStack Query hooks for channel statistics (dashboard).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

// ----- Response Types -----

export interface ChannelStatisticsSummary {
  readonly channelId: string;
  readonly channelName: string;
  readonly enabled: boolean;
  readonly received: number;
  readonly filtered: number;
  readonly sent: number;
  readonly errored: number;
  readonly queued: number;
}

export interface ConnectorStats {
  readonly metaDataId: number | null;
  readonly serverId: string;
  readonly received: number;
  readonly filtered: number;
  readonly sent: number;
  readonly errored: number;
  readonly receivedLifetime: number;
  readonly filteredLifetime: number;
  readonly sentLifetime: number;
  readonly erroredLifetime: number;
}

export interface ChannelStatistics {
  readonly channelId: string;
  readonly connectors: readonly ConnectorStats[];
}

// ----- Query Keys -----

const STATS_KEYS = {
  all: ['statistics'] as const,
  allChannels: () => [...STATS_KEYS.all, 'all-channels'] as const,
  channel: (id: string) => [...STATS_KEYS.all, 'channel', id] as const,
} as const;

// ----- Queries -----

/** Fetch statistics summary for all channels (dashboard). Auto-refreshes every 5s. */
export function useAllChannelStatistics(): ReturnType<typeof useQuery<readonly ChannelStatisticsSummary[]>> {
  return useQuery({
    queryKey: STATS_KEYS.allChannels(),
    queryFn: async () => {
      const result = await api.get<readonly ChannelStatisticsSummary[]>('/channels/statistics');
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    refetchInterval: 5000,
  });
}

/** Fetch per-channel statistics with connector breakdown. */
export function useChannelStatistics(channelId: string | null): ReturnType<typeof useQuery<ChannelStatistics>> {
  return useQuery({
    queryKey: STATS_KEYS.channel(channelId ?? ''),
    queryFn: async () => {
      const result = await api.get<ChannelStatistics>(`/channels/${channelId!}/statistics`);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    enabled: channelId !== null,
    refetchInterval: 5000,
  });
}

// ----- Mutations -----

/** Reset statistics for a channel. */
export function useResetStatistics(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (channelId: string) => {
      const result = await api.post<void>(`/channels/${channelId}/statistics/reset`, {});
      if (!result.success) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: STATS_KEYS.all });
    },
  });
}
