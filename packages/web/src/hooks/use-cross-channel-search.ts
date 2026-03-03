// ===========================================
// Cross-Channel Search Hook
// ===========================================

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

// ----- Types -----

export interface CrossChannelSearchItem {
  readonly messageId: number;
  readonly channelId: string;
  readonly channelName: string;
  readonly receivedAt: string;
  readonly processed: boolean;
  readonly status: string | null;
  readonly connectorName: string | null;
}

export interface CrossChannelSearchResult {
  readonly items: readonly CrossChannelSearchItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface CrossChannelFilters {
  readonly status?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly channelIds?: string;
  readonly limit: number;
  readonly offset: number;
}

// ----- Query Keys -----

const SEARCH_KEYS = {
  all: ['cross-channel-search'] as const,
  search: (filters: CrossChannelFilters) => [...SEARCH_KEYS.all, filters] as const,
} as const;

// ----- Hook -----

export function useCrossChannelSearch(filters: CrossChannelFilters): ReturnType<typeof useQuery<CrossChannelSearchResult>> {
  return useQuery({
    queryKey: SEARCH_KEYS.search(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', String(filters.limit));
      params.set('offset', String(filters.offset));
      if (filters.status) params.set('status', filters.status);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      if (filters.channelIds) params.set('channelIds', filters.channelIds);

      const result = await api.get<CrossChannelSearchResult>(`/messages?${params.toString()}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}
