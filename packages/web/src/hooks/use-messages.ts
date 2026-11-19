import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { messageFilterParts, type MessageFilters } from '../lib/message-filter-query.js';

export interface ConnectorSummary {
  readonly metaDataId: number;
  readonly connectorName: string | null;
  readonly status: string;
  readonly sendAttempts: number;
}

export interface MessageSummary {
  readonly messageId: number;
  readonly correlationId: string;
  readonly receivedAt: string;
  readonly processed: boolean;
  readonly processedAt: string | null;
  readonly connectors: readonly ConnectorSummary[];
}

export interface MessageSearchResult {
  readonly items: readonly MessageSummary[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface ConnectorContent {
  readonly [key: string]: string | undefined;
}

export interface ConnectorDetail {
  readonly metaDataId: number;
  readonly connectorName: string | null;
  readonly status: string;
  readonly sendAttempts: number;
  readonly content: ConnectorContent;
}

export interface MessageDetail {
  readonly messageId: number;
  readonly correlationId: string;
  readonly receivedAt: string;
  readonly processed: boolean;
  readonly processedAt: string | null;
  readonly serverId: string | null;
  readonly connectors: readonly ConnectorDetail[];
}

export interface MessageSearchParams extends MessageFilters {
  readonly channelId: string;
  readonly limit: number;
  readonly offset: number;
  readonly sort: string;
  readonly sortDir: string;
}

export const MESSAGE_KEYS = {
  all: ['messages'] as const,
  channelSearches: (channelId: string) => [...MESSAGE_KEYS.all, 'search', channelId] as const,
  search: (channelId: string, params: Record<string, unknown>) =>
    [...MESSAGE_KEYS.channelSearches(channelId), params] as const,
  detail: (channelId: string, messageId: number) =>
    [...MESSAGE_KEYS.all, 'detail', channelId, messageId] as const,
} as const;

export function buildSearchQuery(params: MessageSearchParams): string {
  const parts = messageFilterParts(params);
  parts.push(`limit=${String(params.limit)}`);
  parts.push(`offset=${String(params.offset)}`);
  parts.push(`sort=${params.sort}`);
  parts.push(`sortDir=${params.sortDir}`);
  return parts.join('&');
}

export function useMessageSearch(params: MessageSearchParams): ReturnType<typeof useQuery<MessageSearchResult>> {
  return useQuery({
    queryKey: MESSAGE_KEYS.search(params.channelId, params as unknown as Record<string, unknown>),
    queryFn: async () => {
      const query = buildSearchQuery(params);
      const result = await api.get<MessageSearchResult>(
        `/channels/${params.channelId}/messages?${query}`
      );
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    enabled: params.channelId.length > 0,
    // Fallback for a dropped WebSocket; live push is the primary path.
    refetchInterval: 30_000,
  });
}

export function useMessageDetail(
  channelId: string,
  messageId: number | null,
): ReturnType<typeof useQuery<MessageDetail>> {
  return useQuery({
    queryKey: MESSAGE_KEYS.detail(channelId, messageId ?? 0),
    queryFn: async () => {
      const result = await api.get<MessageDetail>(
        `/channels/${channelId}/messages/${String(messageId!)}`
      );
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    enabled: channelId.length > 0 && messageId !== null,
  });
}

export function useDeleteMessage(): ReturnType<typeof useMutation<void, Error, { channelId: string; messageId: number }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ channelId, messageId }: { channelId: string; messageId: number }) => {
      const result = await api.delete<void>(`/channels/${channelId}/messages/${String(messageId)}`);
      if (!result.success) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: MESSAGE_KEYS.channelSearches(variables.channelId),
      });
    },
  });
}
