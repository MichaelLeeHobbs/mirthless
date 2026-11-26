// #221: the server checks messages:reprocess and messages:delete, not
// channels:deploy and channels:delete, and a custom role can hold one without the other.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lightTheme } from '../../styles/theme.js';

let granted: readonly string[] = [];
let channelDeleted = false;
const idle = (): Record<string, unknown> => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
const ERRORED = { channelId: 'c1', channelName: 'ADT', messageId: 7, status: 'ERROR', receivedAt: '2026-11-15T10:00:00Z' };

vi.mock('../../hooks/use-permissions.js', () => ({
  usePermissions: () => ({ has: (p: string) => granted.includes(p) }),
}));
vi.mock('../../hooks/use-channels.js', () => ({ useChannel: () => ({ data: { name: 'ADT', destinations: [], encryptData: false } }) }));
vi.mock('../../hooks/use-messages.js', () => ({
  useMessageSearch: () => ({ data: { items: [], channelDeleted, total: 0, limit: 25, offset: 0 }, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../../hooks/use-socket.js', () => ({ useSocketEvent: vi.fn(), useSocketRoom: vi.fn(), useThrottledSocketEvent: vi.fn() }));
vi.mock('../../hooks/use-message-actions.js', () => ({ useReprocessMessage: idle, useBulkDeleteMessages: idle }));
vi.mock('../../hooks/use-message-export.js', () => ({ useMessageExport: () => ({ exportMessages: vi.fn(), isExporting: false }) }));
vi.mock('../../hooks/use-cross-channel-search.js', () => ({
  useCrossChannelSearch: () => ({ data: { items: [ERRORED], total: 1 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../../components/messages/MessageSearchBar.js', () => ({ MessageSearchBar: () => null }));
vi.mock('../../components/messages/MessageDetail.js', () => ({ MessageDetailPanel: (props: { channelDeleted: boolean }) => `detail of a ${props.channelDeleted ? 'deleted' : 'live'} channel` }));
vi.mock('../../components/messages/BulkMessageActionsToolbar.js', () => ({ BulkMessageActionsToolbar: (props: { channelDeleted: boolean }) => `bulk actions of a ${props.channelDeleted ? 'deleted' : 'live'} channel` }));
vi.mock('../../components/messages/MessageTable.js', () => ({
  MessageTable: ({ onSelect }: { onSelect: (id: number) => void }) => (
    <button type="button" onClick={() => { onSelect(7); }}>select message 7</button>
  ),
}));
vi.mock('../../components/traffic/TrafficSummary.js', () => ({ TrafficSummary: () => null }));
vi.mock('../../components/traffic/MessageResultsTable.js', () => ({
  MessageResultsTable: ({ onReprocess }: { onReprocess?: unknown }) => (
    <div>{onReprocess ? 'reprocess offered' : 'reprocess not offered'}</div>
  ),
}));

const { MessageBrowserPage } = await import('../MessageBrowserPage.js');
const { TrafficPage } = await import('../TrafficPage.js');

function renderAt(path: string, element: React.ReactNode, permissions: readonly string[]): void {
  granted = permissions;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider theme={lightTheme}>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path="/channels/:id/messages" element={element} /><Route path="/traffic" element={element} /></Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const button = (name: string): HTMLButtonElement => screen.getByRole('button', { name }) as HTMLButtonElement;

afterEach(() => { cleanup(); channelDeleted = false; });

describe('MessageBrowserPage message actions', () => {
  function openMessage(permissions: readonly string[]): void {
    renderAt('/channels/c1/messages', <MessageBrowserPage />, permissions);
    fireEvent.click(screen.getByText('select message 7'));
  }

  it('enables Reprocess and Delete for a role with the message permissions and no channel rights', () => {
    openMessage(['channels:read', 'messages:read', 'messages:reprocess', 'messages:delete']);
    expect(button('Reprocess').disabled).toBe(false);
    expect(button('Delete').disabled).toBe(false);
  });

  it('disables Reprocess and Delete for a role with channel rights but not the message permissions', () => {
    openMessage(['channels:read', 'messages:read', 'channels:deploy', 'channels:delete']);
    expect(button('Reprocess').disabled).toBe(true);
    expect(button('Delete').disabled).toBe(true);
  });

  it('says that the channel is deleted, and offers no reprocessing then, but deletion (#202)', () => {
    channelDeleted = true;
    openMessage(['channels:read', 'messages:read', 'messages:reprocess', 'messages:delete']);

    expect(screen.getByRole('alert').textContent).toContain('This channel is deleted. Its messages are kept');
    expect(button('Reprocess').disabled).toBe(true);
    expect(button('Delete').disabled).toBe(false);
    expect(document.body.textContent).toMatch(/detail of a deleted channel.*bulk actions of a deleted channel/);
  });

  it('says nothing of the kind of a channel that is there', () => {
    openMessage(['channels:read', 'messages:read', 'messages:reprocess', 'messages:delete']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toMatch(/detail of a live channel.*bulk actions of a live channel/);
  });

  it('names the missing message permission in the tooltip', () => {
    openMessage(['channels:read', 'messages:read']);
    expect(screen.getByLabelText('Requires messages:reprocess permission')).toBeTruthy();
    expect(screen.getByLabelText('Requires messages:delete permission')).toBeTruthy();
  });
});

describe('TrafficPage reprocess', () => {
  it('offers reprocess to a role with messages:reprocess and no deploy right', () => {
    renderAt('/traffic', <TrafficPage />, ['messages:read', 'messages:reprocess']);
    expect(screen.getByText('reprocess offered')).toBeTruthy();
  });

  it('does not offer reprocess to a role with deploy but not messages:reprocess', () => {
    renderAt('/traffic', <TrafficPage />, ['messages:read', 'channels:deploy']);
    expect(screen.getByText('reprocess not offered')).toBeTruthy();
  });
});
