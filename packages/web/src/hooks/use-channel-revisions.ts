// ===========================================
// Channel Revision API Hooks
// ===========================================

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

// ----- Types -----

export interface RevisionSummary {
  readonly id: string;
  readonly channelId: string;
  readonly revision: number;
  readonly userId: string | null;
  readonly comment: string | null;
  readonly createdAt: string;
}

export interface RevisionDetail extends RevisionSummary {
  readonly snapshot: Record<string, unknown>;
}

// ----- Query Keys -----

const REV_KEYS = {
  all: ['channel-revisions'] as const,
  list: (channelId: string) => [...REV_KEYS.all, 'list', channelId] as const,
  detail: (channelId: string, rev: number) => [...REV_KEYS.all, 'detail', channelId, rev] as const,
} as const;

// ----- Hooks -----

export function useChannelRevisions(channelId: string): ReturnType<typeof useQuery<readonly RevisionSummary[]>> {
  return useQuery({
    queryKey: REV_KEYS.list(channelId),
    queryFn: async () => {
      const result = await api.get<readonly RevisionSummary[]>(`/channels/${channelId}/revisions`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: channelId.length > 0,
  });
}

export function useChannelRevision(channelId: string, rev: number): ReturnType<typeof useQuery<RevisionDetail>> {
  return useQuery({
    queryKey: REV_KEYS.detail(channelId, rev),
    queryFn: async () => {
      const result = await api.get<RevisionDetail>(`/channels/${channelId}/revisions/${String(rev)}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: channelId.length > 0 && rev > 0,
  });
}
