// ===========================================
// Channel Group API Hooks
// ===========================================
// TanStack Query hooks for channel group CRUD + member management.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateChannelGroupInput, UpdateChannelGroupInput } from '@mirthless/core-models';
import { api } from '../api/client.js';

// ----- Types -----

export interface ChannelGroupSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly revision: number;
  readonly memberCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChannelGroupDetail extends ChannelGroupSummary {
  readonly channels: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

// ----- Query Keys -----

const GROUP_KEYS = {
  all: ['channel-groups'] as const,
  list: () => [...GROUP_KEYS.all, 'list'] as const,
  detail: (id: string) => [...GROUP_KEYS.all, 'detail', id] as const,
} as const;

// ----- Hooks -----

export function useChannelGroups(): ReturnType<typeof useQuery<readonly ChannelGroupSummary[]>> {
  return useQuery({
    queryKey: GROUP_KEYS.list(),
    queryFn: async () => {
      const result = await api.get<readonly ChannelGroupSummary[]>('/channel-groups');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useChannelGroup(id: string): ReturnType<typeof useQuery<ChannelGroupDetail>> {
  return useQuery({
    queryKey: GROUP_KEYS.detail(id),
    queryFn: async () => {
      const result = await api.get<ChannelGroupDetail>(`/channel-groups/${id}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: id.length > 0,
  });
}

// ----- Group Membership Types -----

export interface GroupMembership {
  readonly channelGroupId: string;
  readonly channelId: string;
}

export function useGroupMemberships(): ReturnType<typeof useQuery<readonly GroupMembership[]>> {
  return useQuery({
    queryKey: [...GROUP_KEYS.all, 'memberships'] as const,
    queryFn: async () => {
      const result = await api.get<readonly GroupMembership[]>('/channel-groups/memberships');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useCreateChannelGroup(): ReturnType<typeof useMutation<ChannelGroupSummary, Error, CreateChannelGroupInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateChannelGroupInput) => {
      const result = await api.post<ChannelGroupSummary>('/channel-groups', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: GROUP_KEYS.all });
    },
  });
}

export function useUpdateChannelGroup(): ReturnType<typeof useMutation<ChannelGroupSummary, Error, { id: string; input: UpdateChannelGroupInput }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateChannelGroupInput }) => {
      const result = await api.put<ChannelGroupSummary>(`/channel-groups/${id}`, input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: GROUP_KEYS.all });
    },
  });
}

export function useDeleteChannelGroup(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.delete<void>(`/channel-groups/${id}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: GROUP_KEYS.all });
    },
  });
}

export function useAddGroupMember(): ReturnType<typeof useMutation<void, Error, { groupId: string; channelId: string }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ groupId, channelId }: { groupId: string; channelId: string }) => {
      const result = await api.post<void>(`/channel-groups/${groupId}/members`, { channelId });
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: GROUP_KEYS.all });
    },
  });
}

export function useRemoveGroupMember(): ReturnType<typeof useMutation<void, Error, { groupId: string; channelId: string }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ groupId, channelId }: { groupId: string; channelId: string }) => {
      const result = await api.delete<void>(`/channel-groups/${groupId}/members/${channelId}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: GROUP_KEYS.all });
    },
  });
}
