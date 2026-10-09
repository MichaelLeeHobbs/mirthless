// ===========================================
// AlertsPage permission gating Tests
// ===========================================
// Users without alerts:write must not be offered the edit flow: the server
// rejects their saves, and the editor route is gated the same way.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../styles/theme.js';

let granted: readonly string[] = [];

vi.mock('../../hooks/use-permissions.js', () => ({
  usePermissions: () => ({ has: (p: string) => granted.includes(p) }),
}));

vi.mock('../../hooks/use-alerts.js', () => ({
  useAlerts: () => ({
    data: {
      data: [{ id: 'a-1', name: 'Lab feed down', description: null, enabled: true, triggerType: 'NO_MESSAGES', channelCount: 1, actionCount: 1 }],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    },
    isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
  }),
  useDeleteAlert: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleAlertEnabled: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AlertsPage } from '../AlertsPage.js';

function renderPage(permissions: readonly string[]): void {
  granted = permissions;
  render(
    <ThemeProvider theme={darkTheme}>
      <MemoryRouter><AlertsPage /></MemoryRouter>
    </ThemeProvider>,
  );
}

afterEach(() => { cleanup(); });

describe('AlertsPage', () => {
  it('offers edit to users with alerts:write', () => {
    renderPage(['alerts:read', 'alerts:write']);
    expect(screen.getByLabelText('Edit alert')).toBeTruthy();
  });

  it('hides edit and delete from read-only users but still lists the alert', () => {
    renderPage(['alerts:read']);
    expect(screen.getByText('Lab feed down')).toBeTruthy();
    expect(screen.queryByLabelText('Edit alert')).toBeNull();
    expect(screen.queryByLabelText('Delete alert')).toBeNull();
  });
});
