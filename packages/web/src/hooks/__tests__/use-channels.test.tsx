// ===========================================
// Channel Hook Tests (delete)
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useDeleteChannel } from '../use-channels.js';
import { STATS_KEYS } from '../use-statistics.js';

const deleteMock = vi.fn();

vi.mock('../../api/client.js', () => ({
  api: {
    delete: (path: string) => deleteMock(path),
  },
  apiFetch: vi.fn(),
}));

function setup(): { client: QueryClient; wrapper: (props: { children: ReactNode }) => ReactNode } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

describe('useDeleteChannel', () => {
  beforeEach(() => { deleteMock.mockReset(); });

  it('refreshes both the channel list and the dashboard statistics after deleting', async () => {
    deleteMock.mockResolvedValue({ success: true, data: undefined });
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteChannel(), { wrapper });

    await result.current.mutateAsync('c1');

    expect(deleteMock).toHaveBeenCalledWith('/channels/c1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['channels', 'list'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: STATS_KEYS.all });
  });

  it('throws with the server message and refreshes nothing on failure', async () => {
    deleteMock.mockResolvedValue({ success: false, error: { code: 'NOT_FOUND', message: 'gone' } });
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteChannel(), { wrapper });

    await expect(result.current.mutateAsync('c1')).rejects.toThrow('gone');
    expect(invalidate).not.toHaveBeenCalled();
  });
});
