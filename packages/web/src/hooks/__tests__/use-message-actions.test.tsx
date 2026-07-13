// ===========================================
// Message Action Hook Tests (bulk reprocess + resend)
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useBulkReprocessMessages, useResendDestination } from '../use-message-actions.js';

const postMock = vi.fn();

vi.mock('../../api/client.js', () => ({
  api: {
    post: (path: string, body: unknown) => postMock(path, body),
  },
  apiFetch: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

describe('useBulkReprocessMessages', () => {
  beforeEach(() => { postMock.mockReset(); });

  it('POSTs the messageIds to the bulk-reprocess endpoint and returns the summary', async () => {
    postMock.mockResolvedValue({
      success: true,
      data: { requested: 2, reprocessed: 1, results: [{ messageId: 1, newMessageId: 5 }, { messageId: 2, error: 'boom' }] },
    });
    const { result } = renderHook(() => useBulkReprocessMessages(), { wrapper });

    const summary = await result.current.mutateAsync({ channelId: 'c1', messageIds: [1, 2] });

    expect(postMock).toHaveBeenCalledWith('/channels/c1/messages/bulk-reprocess', { messageIds: [1, 2] });
    expect(summary.requested).toBe(2);
    expect(summary.reprocessed).toBe(1);
    expect(summary.results).toHaveLength(2);
  });

  it('throws with the server message on failure', async () => {
    postMock.mockResolvedValue({ success: false, error: { code: 'X', message: 'nope' } });
    const { result } = renderHook(() => useBulkReprocessMessages(), { wrapper });
    await expect(result.current.mutateAsync({ channelId: 'c1', messageIds: [1] })).rejects.toThrow('nope');
  });
});

describe('useResendDestination', () => {
  beforeEach(() => { postMock.mockReset(); });

  it('POSTs to the per-connector resend endpoint', async () => {
    postMock.mockResolvedValue({ success: true, data: { messageId: 9, metaDataId: 2, message: 'queued' } });
    const { result } = renderHook(() => useResendDestination(), { wrapper });

    const res = await result.current.mutateAsync({ channelId: 'c1', messageId: 9, metaDataId: 2 });

    expect(postMock).toHaveBeenCalledWith('/channels/c1/messages/9/connectors/2/resend', {});
    expect(res.message).toBe('queued');
  });

  it('surfaces a 501/again error message without assuming success', async () => {
    postMock.mockResolvedValue({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Not implemented' } });
    const { result } = renderHook(() => useResendDestination(), { wrapper });
    await waitFor(async () => {
      await expect(result.current.mutateAsync({ channelId: 'c1', messageId: 1, metaDataId: 1 })).rejects.toThrow('Not implemented');
    });
  });
});
