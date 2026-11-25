import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

interface MessageNumbers {
  readonly messages: number;
  /** Of them, those that are not processed or wait on a queue. */
  readonly undelivered: number;
}

export interface DeletedChannel extends MessageNumbers {
  readonly channelId: string;
  readonly name: string;
  readonly deletedAt: string;
  readonly firstReceivedAt: string | null;
  readonly lastReceivedAt: string | null;
  /** Null when the pruner leaves them. */
  readonly prunedAfterDays: number | null;
}

interface PurgeInput {
  readonly channelId: string;
  readonly reason: string;
}

const PATH = '/admin/prune/deleted-channels';
const DELETED_CHANNEL_KEYS = ['deleted-channels'] as const;

export function useDeletedChannels(): ReturnType<typeof useQuery<readonly DeletedChannel[]>> {
  return useQuery({
    queryKey: DELETED_CHANNEL_KEYS,
    queryFn: async () => {
      const result = await api.get<readonly DeletedChannel[]>(PATH);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function usePurgeDeletedChannel(): ReturnType<typeof useMutation<MessageNumbers, Error, PurgeInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ channelId, reason }: PurgeInput) => {
      const result = await api.post<MessageNumbers>(`${PATH}/${channelId}`, { reason });
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: DELETED_CHANNEL_KEYS });
    },
  });
}
