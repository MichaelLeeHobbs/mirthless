import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { darkTheme } from '../../../styles/theme.js';
import { BulkMessageActionsToolbar } from '../BulkMessageActionsToolbar.js';
import { useAuthStore } from '../../../stores/auth.store.js';
import { useNotificationStore } from '../../../stores/notification.store.js';
import { PERMISSION } from '../../../lib/permissions.js';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../../api/client.js', () => ({ api: {}, apiFetch }));

function renderToolbar(node: ReactElement): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={darkTheme}>{node}</ThemeProvider>
    </QueryClientProvider>,
  );
}

function setPermissions(permissions: readonly string[]): void {
  useAuthStore.setState({
    user: { id: 'u1', username: 't', email: 't@e.com', role: 'admin', permissions },
    accessToken: 'tok',
    isAuthenticated: true,
  });
}

describe('BulkMessageActionsToolbar', () => {
  beforeEach(() => { setPermissions([]); });
  afterEach(() => { cleanup(); });

  it('renders nothing when no messages are selected', () => {
    renderToolbar(
      <BulkMessageActionsToolbar channelId="c1" channelDeleted={false} selectedIds={new Set()} onClear={() => {}} />,
    );
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('shows the selected count and both actions', () => {
    setPermissions([PERMISSION.MESSAGES_REPROCESS, PERMISSION.MESSAGES_DELETE]);
    renderToolbar(
      <BulkMessageActionsToolbar channelId="c1" channelDeleted={false} selectedIds={new Set([1, 2, 3])} onClear={() => {}} />,
    );
    expect(screen.getByText('3 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: /reprocess/i })).not.toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
  });

  it('names the messages that were not deleted because something still works on them', async () => {
    setPermissions([PERMISSION.MESSAGES_DELETE]);
    apiFetch.mockResolvedValue({ success: true, data: { deletedCount: 1, refusedIds: [2] } });
    const onClear = vi.fn();
    renderToolbar(<BulkMessageActionsToolbar channelId="c1" channelDeleted={false} selectedIds={new Set([1, 2])} onClear={onClear} />);

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('still waits on a queue is not sent');
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => { expect(onClear).toHaveBeenCalledOnce(); });
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith('/channels/c1/messages/bulk', { method: 'DELETE', body: { messageIds: [1, 2] } });
    expect(useNotificationStore.getState().notifications).toEqual([expect.objectContaining({ severity: 'warning', message: expect.stringContaining('not deleted: #2') as string })]);
  });

  it('offers no reprocessing of the messages of a deleted channel, and their deletion (#202)', () => {
    setPermissions([PERMISSION.MESSAGES_REPROCESS, PERMISSION.MESSAGES_DELETE]);
    renderToolbar(
      <BulkMessageActionsToolbar channelId="c1" channelDeleted selectedIds={new Set([1])} onClear={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /reprocess/i })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /^delete$/i })).toHaveProperty('disabled', false);
  });

  it('disables actions when the user lacks permissions', () => {
    setPermissions([]);
    renderToolbar(
      <BulkMessageActionsToolbar channelId="c1" channelDeleted={false} selectedIds={new Set([1])} onClear={() => {}} />,
    );
    const reprocess = screen.getByRole('button', { name: /reprocess/i });
    const del = screen.getByRole('button', { name: /^delete$/i });
    expect((reprocess as HTMLButtonElement).disabled).toBe(true);
    expect((del as HTMLButtonElement).disabled).toBe(true);
  });
});
