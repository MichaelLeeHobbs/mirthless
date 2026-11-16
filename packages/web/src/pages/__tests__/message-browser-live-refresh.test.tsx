// ===========================================
// Message browser live refresh (#231, D-306)
// ===========================================
// A message:new event refreshes the channel's message list, through the
// throttled socket hook, and leaves an open message's detail alone: the detail
// does not change when other messages arrive, and refetching it on every event
// re-reads PHI content for nothing.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { lightTheme } from '../../styles/theme.js';

const throttled = vi.hoisted(() => new Map<string, () => void>());
const plainEvents = vi.hoisted(() => [] as string[]);

vi.mock('../../hooks/use-socket.js', () => ({
  useSocketRoom: vi.fn(),
  useSocketEvent: (event: string) => { plainEvents.push(event); },
  useThrottledSocketEvent: (event: string, handler: () => void) => { throttled.set(event, handler); },
}));
vi.mock('../../hooks/use-messages.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/use-messages.js')>()),
  useMessageSearch: () => ({ data: { items: [], total: 0, limit: 25, offset: 0 }, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../../hooks/use-permissions.js', () => ({ usePermissions: () => ({ has: () => true }) }));
vi.mock('../../hooks/use-channels.js', () => ({ useChannel: () => ({ data: { name: 'ADT', destinations: [], encryptData: false } }) }));
vi.mock('../../hooks/use-message-actions.js', () => ({
  useReprocessMessage: () => ({ mutate: vi.fn() }),
  useBulkDeleteMessages: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../hooks/use-message-export.js', () => ({ useMessageExport: () => ({ exportMessages: vi.fn(), isExporting: false }) }));
vi.mock('../../components/messages/MessageSearchBar.js', () => ({ MessageSearchBar: () => null }));
vi.mock('../../components/messages/MessageDetail.js', () => ({ MessageDetailPanel: () => null }));
vi.mock('../../components/messages/BulkMessageActionsToolbar.js', () => ({ BulkMessageActionsToolbar: () => null }));
vi.mock('../../components/messages/MessageTable.js', () => ({ MessageTable: () => null }));

const { MessageBrowserPage } = await import('../MessageBrowserPage.js');
const { MESSAGE_KEYS } = await import('../../hooks/use-messages.js');

afterEach(() => {
  cleanup();
  throttled.clear();
  plainEvents.length = 0;
});

function renderPage(client: QueryClient): void {
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={lightTheme}>
        <MemoryRouter initialEntries={['/channels/c1/messages']}>
          <Routes><Route path="/channels/:id/messages" element={<MessageBrowserPage />} /></Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('MessageBrowserPage live refresh', () => {
  it('listens for message:new only through the throttled hook', () => {
    renderPage(new QueryClient());
    expect(throttled.has('message:new')).toBe(true);
    expect(plainEvents).not.toContain('message:new');
  });

  it('invalidates the channel message list and not an open message detail or another channel', () => {
    const client = new QueryClient();
    const list = MESSAGE_KEYS.search('c1', { offset: 0 });
    const detail = MESSAGE_KEYS.detail('c1', 7);
    const otherList = MESSAGE_KEYS.search('c2', { offset: 0 });
    for (const key of [list, detail, otherList]) client.setQueryData(key, {});
    const invalidated = (key: QueryKey): boolean | undefined => client.getQueryState(key)?.isInvalidated;

    renderPage(client);
    throttled.get('message:new')?.();

    expect(invalidated(list)).toBe(true);
    expect(invalidated(detail)).toBe(false);
    expect(invalidated(otherList)).toBe(false);
  });
});
