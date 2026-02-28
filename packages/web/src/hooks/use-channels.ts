// ===========================================
// Channel API Hooks
// ===========================================
// TanStack Query hooks for channel CRUD operations.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateChannelInput, UpdateChannelInput } from '@mirthless/core-models';
import { api } from '../api/client.js';

// ----- Response Types (mirror server's ChannelSummary/ChannelDetail) -----

export interface ChannelSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly revision: number;
  readonly inboundDataType: string;
  readonly outboundDataType: string;
  readonly sourceConnectorType: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChannelDetail extends ChannelSummary {
  readonly responseMode: string;
  readonly responseConnectorName: string | null;
  readonly initialState: string;
  readonly messageStorageMode: string;
  readonly encryptData: boolean;
  readonly removeContentOnCompletion: boolean;
  readonly removeAttachmentsOnCompletion: boolean;
  readonly pruningEnabled: boolean;
  readonly pruningMaxAgeDays: number | null;
  readonly pruningArchiveEnabled: boolean;
  readonly sourceConnectorProperties: Record<string, unknown>;
  readonly scripts: ReadonlyArray<{
    readonly id: string;
    readonly scriptType: string;
    readonly script: string;
  }>;
  readonly destinations: ReadonlyArray<{
    readonly id: string;
    readonly metaDataId: number;
    readonly name: string;
    readonly enabled: boolean;
    readonly connectorType: string;
    readonly properties: Record<string, unknown>;
    readonly queueMode: string;
    readonly retryCount: number;
    readonly retryIntervalMs: number;
    readonly rotateQueue: boolean;
    readonly queueThreadCount: number;
    readonly waitForPrevious: boolean;
  }>;
  readonly metadataColumns: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly dataType: string;
    readonly mappingExpression: string | null;
  }>;
  readonly tags: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly color: string | null;
  }>;
}

interface ChannelListResponse {
  readonly data: ReadonlyArray<ChannelSummary>;
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

// ----- Query Keys -----

const CHANNEL_KEYS = {
  all: ['channels'] as const,
  lists: () => [...CHANNEL_KEYS.all, 'list'] as const,
  list: (page: number, pageSize: number) => [...CHANNEL_KEYS.lists(), { page, pageSize }] as const,
  details: () => [...CHANNEL_KEYS.all, 'detail'] as const,
  detail: (id: string) => [...CHANNEL_KEYS.details(), id] as const,
} as const;

// ----- Queries -----

/** Fetch paginated channel list. */
export function useChannels(page: number = 1, pageSize: number = 25): ReturnType<typeof useQuery<ChannelListResponse>> {
  return useQuery({
    queryKey: CHANNEL_KEYS.list(page, pageSize),
    queryFn: async () => {
      const result = await api.get<ChannelListResponse>(
        `/channels?page=${String(page)}&pageSize=${String(pageSize)}`
      );
      if (!result.success) {
        throw new Error(result.error.message);
      }
      // The server returns { success, data, pagination } but our api.get unwraps to { success, data }
      // where data = { data: [...], pagination: {...} } from the controller
      return result.data;
    },
  });
}

/** Fetch a single channel's full detail. */
export function useChannel(id: string | null): ReturnType<typeof useQuery<ChannelDetail>> {
  return useQuery({
    queryKey: CHANNEL_KEYS.detail(id ?? ''),
    queryFn: async () => {
      const result = await api.get<ChannelDetail>(`/channels/${id!}`);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    enabled: id !== null,
  });
}

// ----- Mutations -----

/** Create a new channel. */
export function useCreateChannel(): ReturnType<typeof useMutation<ChannelDetail, Error, CreateChannelInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateChannelInput) => {
      const result = await api.post<ChannelDetail>('/channels', input);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CHANNEL_KEYS.lists() });
    },
  });
}

/** Update an existing channel. */
export function useUpdateChannel(): ReturnType<typeof useMutation<ChannelDetail, Error, { id: string; input: UpdateChannelInput }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateChannelInput }) => {
      const result = await api.put<ChannelDetail>(`/channels/${id}`, input);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CHANNEL_KEYS.lists() }),
        queryClient.invalidateQueries({ queryKey: CHANNEL_KEYS.detail(variables.id) }),
      ]);
    },
  });
}

/** Soft-delete a channel. */
export function useDeleteChannel(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.delete<void>(`/channels/${id}`);
      if (!result.success) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CHANNEL_KEYS.lists() });
    },
  });
}

/** Toggle channel enabled flag. */
export function useToggleChannelEnabled(): ReturnType<typeof useMutation<ChannelDetail, Error, { id: string; enabled: boolean }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const result = await api.patch<ChannelDetail>(`/channels/${id}/enabled`, { enabled });
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CHANNEL_KEYS.lists() }),
        queryClient.invalidateQueries({ queryKey: CHANNEL_KEYS.detail(variables.id) }),
      ]);
    },
  });
}
