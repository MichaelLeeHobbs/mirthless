// ===========================================
// Deployment API Hooks
// ===========================================
// TanStack Query hooks for channel deployment actions.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

// ----- Response Types -----

export interface ChannelStatus {
  readonly channelId: string;
  readonly state: string;
}

// ----- Query Keys -----

export const DEPLOYMENT_KEYS = {
  all: ['deployment'] as const,
  statuses: () => [...DEPLOYMENT_KEYS.all, 'statuses'] as const,
  status: (id: string) => [...DEPLOYMENT_KEYS.all, 'status', id] as const,
} as const;

// ----- Queries -----

/** Fetch deployment status for all channels. Auto-refreshes every 5s. */
export function useAllDeploymentStatuses(): ReturnType<typeof useQuery<readonly ChannelStatus[]>> {
  return useQuery({
    queryKey: DEPLOYMENT_KEYS.statuses(),
    queryFn: async () => {
      const result = await api.get<readonly ChannelStatus[]>('/channels/status');
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    refetchInterval: 5000,
  });
}

// ----- Mutations -----

type DeploymentAction = 'deploy' | 'undeploy' | 'start' | 'stop' | 'halt' | 'pause' | 'resume';

interface DeploymentInput {
  readonly channelId: string;
  readonly action: DeploymentAction;
}

/** Execute a deployment action on a channel. */
export function useDeploymentAction(): ReturnType<typeof useMutation<ChannelStatus, Error, DeploymentInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ channelId, action }: DeploymentInput) => {
      const result = await api.post<ChannelStatus>(`/channels/${channelId}/${action}`, {});
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DEPLOYMENT_KEYS.statuses() }),
        queryClient.invalidateQueries({ queryKey: ['statistics'] }),
      ]);
    },
  });
}

// ----- Send Message -----

interface SendMessageInput {
  readonly channelId: string;
  readonly content: string;
}

interface SendMessageResult {
  readonly messageId: number;
}

/** Send a raw message to a deployed, started channel. */
export function useSendMessage(): ReturnType<typeof useMutation<SendMessageResult, Error, SendMessageInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ channelId, content }: SendMessageInput) => {
      const result = await api.post<SendMessageResult>(`/channels/${channelId}/send-message`, { content });
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['statistics'] });
    },
  });
}
