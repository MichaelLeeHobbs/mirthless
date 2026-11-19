import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

export interface ChannelStatisticsSummary {
  readonly channelId: string;
  readonly channelName: string;
  readonly enabled: boolean;
  readonly sourceConnectorType: string;
  readonly inboundDataType: string;
  readonly outboundDataType: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly received: number;
  readonly filtered: number;
  readonly sent: number;
  readonly errored: number;
  readonly queued: number;
}

export const STATS_KEYS = {
  all: ['statistics'] as const,
  allChannels: () => [...STATS_KEYS.all, 'all-channels'] as const,
} as const;

/** WebSocket events refresh it; the 60 s poll is the fallback. */
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
    refetchInterval: 60_000,
  });
}
