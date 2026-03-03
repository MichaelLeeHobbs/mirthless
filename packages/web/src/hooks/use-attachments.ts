// ===========================================
// Attachment API Hooks
// ===========================================
// TanStack Query hooks for message attachment queries.

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

// ----- Types -----

export interface AttachmentSummary {
  readonly id: string;
  readonly segmentId: number;
  readonly mimeType: string | null;
  readonly attachmentSize: number;
  readonly isEncrypted: boolean;
}

export interface AttachmentDetail extends AttachmentSummary {
  readonly content: string;
}

// ----- Query Keys -----

const ATTACH_KEYS = {
  all: ['attachments'] as const,
  list: (channelId: string, messageId: number) => [...ATTACH_KEYS.all, 'list', channelId, messageId] as const,
  detail: (channelId: string, messageId: number, attachmentId: string) =>
    [...ATTACH_KEYS.all, 'detail', channelId, messageId, attachmentId] as const,
} as const;

// ----- Hooks -----

export function useAttachments(
  channelId: string,
  messageId: number,
): ReturnType<typeof useQuery<readonly AttachmentSummary[]>> {
  return useQuery({
    queryKey: ATTACH_KEYS.list(channelId, messageId),
    queryFn: async () => {
      const result = await api.get<readonly AttachmentSummary[]>(
        `/channels/${channelId}/messages/${String(messageId)}/attachments`,
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: channelId.length > 0 && messageId > 0,
  });
}

export function useAttachment(
  channelId: string,
  messageId: number,
  attachmentId: string,
): ReturnType<typeof useQuery<AttachmentDetail>> {
  return useQuery({
    queryKey: ATTACH_KEYS.detail(channelId, messageId, attachmentId),
    queryFn: async () => {
      const result = await api.get<AttachmentDetail>(
        `/channels/${channelId}/messages/${String(messageId)}/attachments/${attachmentId}`,
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: channelId.length > 0 && messageId > 0 && attachmentId.length > 0,
  });
}
