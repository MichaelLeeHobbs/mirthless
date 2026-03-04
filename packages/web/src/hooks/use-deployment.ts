// ===========================================
// Deployment API Hooks
// ===========================================
// TanStack Query hooks for channel deployment actions.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useNotificationStore } from '../stores/notification.store.js';

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
    onSuccess: async (_data, { action }) => {
      const actionLabels: Record<DeploymentAction, string> = {
        deploy: 'deployed',
        undeploy: 'undeployed',
        start: 'started',
        stop: 'stopped',
        halt: 'halted',
        pause: 'paused',
        resume: 'resumed',
      };
      useNotificationStore.getState().notify(`Channel ${actionLabels[action]}`, 'success');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DEPLOYMENT_KEYS.statuses() }),
        queryClient.invalidateQueries({ queryKey: ['statistics'] }),
      ]);
    },
    onError: (err: Error) => {
      useNotificationStore.getState().notify(err.message || 'Deployment action failed', 'error');
    },
  });
}
