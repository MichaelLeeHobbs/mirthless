import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { usePurgeDeletedChannel } from '../use-deleted-channels.js';

const postMock = vi.fn();

vi.mock('../../api/client.js', () => ({
  api: { post: (path: string, body: unknown) => postMock(path, body) },
  apiFetch: vi.fn(),
}));

function setup(): { client: QueryClient; wrapper: (props: { children: ReactNode }) => ReactNode } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

describe('usePurgeDeletedChannel', () => {
  beforeEach(() => { postMock.mockReset(); });

  it('sends the reason and reads the list again', async () => {
    postMock.mockResolvedValue({ success: true, data: { messages: 2, undelivered: 0 } });
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => usePurgeDeletedChannel(), { wrapper });

    await expect(result.current.mutateAsync({ channelId: 'c1', reason: 'moved' })).resolves.toEqual({ messages: 2, undelivered: 0 });

    expect(postMock).toHaveBeenCalledWith('/admin/prune/deleted-channels/c1', { reason: 'moved' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['deleted-channels'] });
  });

  // A refusal can come after another administrator removed them, so the list is read again then too.
  it('throws with the server message, and reads the list again', async () => {
    postMock.mockResolvedValue({ success: false, error: { code: 'CONFLICT', message: 'Nothing was removed' } });
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => usePurgeDeletedChannel(), { wrapper });

    await expect(result.current.mutateAsync({ channelId: 'c1', reason: 'moved' })).rejects.toThrow('Nothing was removed');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['deleted-channels'] });
  });
});
