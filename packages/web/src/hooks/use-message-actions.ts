// ===========================================
// Message Action Hooks
// ===========================================
// Reprocess and bulk delete operations for messages.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiFetch } from '../api/client.js';

// ----- Types -----

interface ReprocessResult {
  readonly messageId: number;
  readonly rawContent: string;
}

interface BulkDeleteResult {
  readonly deletedCount: number;
}

// ----- Hooks -----

export function useReprocessMessage(): ReturnType<typeof useMutation<ReprocessResult, Error, { channelId: string; messageId: number }>> {
  return useMutation({
    mutationFn: async ({ channelId, messageId }: { channelId: string; messageId: number }) => {
      const result = await api.post<ReprocessResult>(
        `/channels/${channelId}/messages/${String(messageId)}/reprocess`,
        {},
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useBulkDeleteMessages(): ReturnType<typeof useMutation<BulkDeleteResult, Error, { channelId: string; messageIds: readonly number[] }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ channelId, messageIds }: { channelId: string; messageIds: readonly number[] }) => {
      const result = await apiFetch<BulkDeleteResult>(
        `/channels/${channelId}/messages/bulk`,
        { method: 'DELETE', body: { messageIds } },
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}
