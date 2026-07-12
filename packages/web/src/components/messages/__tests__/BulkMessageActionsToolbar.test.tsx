// ===========================================
// BulkMessageActionsToolbar Tests
// ===========================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { darkTheme } from '../../../styles/theme.js';
import { BulkMessageActionsToolbar } from '../BulkMessageActionsToolbar.js';
import { useAuthStore } from '../../../stores/auth.store.js';
import { PERMISSION } from '../../../lib/permissions.js';

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
      <BulkMessageActionsToolbar channelId="c1" selectedIds={new Set()} onClear={() => {}} />,
    );
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('shows the selected count and both actions', () => {
    setPermissions([PERMISSION.MESSAGES_REPROCESS, PERMISSION.MESSAGES_DELETE]);
    renderToolbar(
      <BulkMessageActionsToolbar channelId="c1" selectedIds={new Set([1, 2, 3])} onClear={() => {}} />,
    );
    expect(screen.getByText('3 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: /reprocess/i })).not.toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
  });

  it('disables actions when the user lacks permissions', () => {
    setPermissions([]);
    renderToolbar(
      <BulkMessageActionsToolbar channelId="c1" selectedIds={new Set([1])} onClear={() => {}} />,
    );
    const reprocess = screen.getByRole('button', { name: /reprocess/i });
    const del = screen.getByRole('button', { name: /^delete$/i });
    expect((reprocess as HTMLButtonElement).disabled).toBe(true);
    expect((del as HTMLButtonElement).disabled).toBe(true);
  });
});
