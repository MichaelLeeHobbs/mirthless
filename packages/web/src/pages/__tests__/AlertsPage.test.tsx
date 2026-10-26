// ===========================================
// AlertsPage Tests
// ===========================================
// The alert list follows the shared admin-list pattern: readable trigger
// labels, a one-click enabled switch, a named delete confirm, and no pager
// on a short list. Data hooks are mocked at the API boundary.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { lightTheme } from '../../styles/theme.js';

const toggleMutate = vi.fn();
const deleteMutate = vi.fn();
let total = 2;

function alert(id: string, name: string, enabled: boolean): Record<string, unknown> {
  return { id, name, description: null, triggerType: 'CHANNEL_ERROR', channelCount: 1, actionCount: 2, enabled };
}

vi.mock('../../hooks/use-alerts.js', () => ({
  useAlerts: () => ({
    data: { data: [alert('a1', 'Lab feed errors', true), alert('a2', 'Pharmacy down', false)], pagination: { total } },
    isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
  }),
  useDeleteAlert: () => ({ mutate: deleteMutate, isPending: false }),
  useToggleAlertEnabled: () => ({ mutate: toggleMutate, isPending: false }),
}));

import { AlertsPage } from '../AlertsPage.js';

function renderPage(): void {
  render(
    <ThemeProvider theme={lightTheme}>
      <MemoryRouter>
        <AlertsPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => { toggleMutate.mockReset(); deleteMutate.mockReset(); total = 2; });
afterEach(() => { cleanup(); });

describe('AlertsPage', () => {
  it('shows trigger types as sentence-case labels, not raw enums', () => {
    renderPage();
    expect(screen.getAllByText('Channel error')).toHaveLength(2);
    expect(screen.queryByText('CHANNEL_ERROR')).toBeNull();
  });

  it('toggles an alert with one click on its switch', () => {
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Disable Lab feed errors' }));
    expect(toggleMutate).toHaveBeenCalledWith({ id: 'a1', enabled: false });
  });

  it('links the alert name to its editor', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Pharmacy down' }).getAttribute('href')).toBe('/alerts/a2');
  });

  it('names the alert in the delete confirmation and deletes on confirm', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete alert' })[1]!);
    expect(screen.getByText(/Delete the alert "Pharmacy down"/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteMutate).toHaveBeenCalledWith('a2', expect.anything());
  });

  it('hides the pager for a short list and shows it once there is a second page', () => {
    renderPage();
    expect(screen.queryByText(/Rows per page/)).toBeNull();
    cleanup();
    total = 40;
    renderPage();
    expect(screen.getByText(/Rows per page/)).toBeTruthy();
  });
});
