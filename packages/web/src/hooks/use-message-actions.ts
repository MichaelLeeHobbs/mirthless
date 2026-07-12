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

export interface BulkReprocessItemResult {
  readonly messageId: number;
  readonly newMessageId?: number;
  readonly error?: string;
}

export interface BulkReprocessResult {
  readonly requested: number;
  readonly reprocessed: number;
  readonly results: readonly BulkReprocessItemResult[];
}

export interface ResendDestinationResult {
  readonly messageId: number;
  readonly metaDataId: number;
  readonly newMessageId?: number;
  readonly message?: string;
}

// ----- Hooks -----

export function useReprocessMessage(): ReturnType<typeof useMutation<ReprocessResult, Error, { channelId: string; messageId: number }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ channelId, messageId }: { channelId: string; messageId: number }) => {
      const result = await api.post<ReprocessResult>(
        `/channels/${channelId}/messages/${String(messageId)}/reprocess`,
        {},
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages'] });
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

/**
 * Bulk-reprocess a set of messages by re-injecting each into the pipeline.
 * Returns a per-message result so the caller can summarise partial failures.
 */
export function useBulkReprocessMessages(): ReturnType<typeof useMutation<BulkReprocessResult, Error, { channelId: string; messageIds: readonly number[] }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ channelId, messageIds }: { channelId: string; messageIds: readonly number[] }) => {
      const result = await api.post<BulkReprocessResult>(
        `/channels/${channelId}/messages/bulk-reprocess`,
        { messageIds: [...messageIds] },
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}

/**
 * Resend a single message to one destination connector. The server may implement
 * this as a whole-message reprocess fallback or return 501 Not Implemented; the
 * caller must handle both — this hook only surfaces the server's error/message.
 */
export function useResendDestination(): ReturnType<typeof useMutation<ResendDestinationResult, Error, { channelId: string; messageId: number; metaDataId: number }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ channelId, messageId, metaDataId }: { channelId: string; messageId: number; metaDataId: number }) => {
      const result = await api.post<ResendDestinationResult>(
        `/channels/${channelId}/messages/${String(messageId)}/connectors/${String(metaDataId)}/resend`,
        {},
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}
