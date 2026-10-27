// ===========================================
// SettingsPage Tests
// ===========================================
// Settings show in plain-words sections; the save bar appears only once a value
// changes; invalid values block saving; secrets are write-only; pruner settings
// save through the pruner schedule so the schedule changes at once. Data and
// permission hooks are mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../styles/theme.js';
import { useNotificationStore } from '../../stores/notification.store.js';

let granted: readonly string[] = ['settings:read', 'settings:write'];
const bulkMutate = vi.fn();
const scheduleMutate = vi.fn();
const refetch = vi.fn();

function setting(key: string, value: string | null, type: string, category: string): Record<string, unknown> {
  return { id: key, key, value, type, description: null, category, createdAt: '', updatedAt: '' };
}

const SETTINGS = [
  setting('smtp.port', '587', 'number', 'smtp'),
  setting('general.server_name', 'Mirthless', 'string', 'general'),
  setting('smtp.host', '', 'string', 'smtp'),
  setting('smtp.auth_pass', '__REDACTED__', 'password', 'smtp'),
  setting('pruner.enabled', 'false', 'boolean', 'pruner'),
  setting('pruner.cron_expression', '0 3 * * *', 'string', 'pruner'),
  setting('custom.retry_limit', '3', 'number', 'custom'),
];

vi.mock('../../hooks/use-permissions.js', () => ({
  usePermissions: () => ({ has: (p: string) => granted.includes(p) }),
}));

vi.mock('../../hooks/use-settings.js', () => ({
  useSettings: () => ({ data: SETTINGS, isLoading: false, error: null, isFetching: false, refetch }),
  useBulkUpsertSettings: () => ({ mutateAsync: bulkMutate }),
}));

vi.mock('../../hooks/use-pruner.js', () => ({
  useUpdatePrunerSchedule: () => ({ mutateAsync: scheduleMutate }),
}));

import { SettingsPage } from '../SettingsPage.js';

function renderPage(permissions: readonly string[] = ['settings:read', 'settings:write']): void {
  granted = permissions;
  const router = createMemoryRouter([{ path: '/', element: <SettingsPage /> }]);
  render(<ThemeProvider theme={lightTheme}><RouterProvider router={router} /></ThemeProvider>);
}

const field = (name: string): HTMLInputElement => screen.getByLabelText(name, { selector: 'input' });
const saveBar = (): HTMLElement | null => screen.queryByRole('region', { name: 'Unsaved changes' });
const lastNotice = (): string | undefined => useNotificationStore.getState().notifications.at(-1)?.message;

beforeEach(() => {
  bulkMutate.mockReset().mockResolvedValue([]);
  scheduleMutate.mockReset().mockResolvedValue({});
  refetch.mockReset().mockResolvedValue({});
  useNotificationStore.setState({ notifications: [] });
});
afterEach(() => { cleanup(); });

describe('SettingsPage', () => {
  it('groups settings into named sections with plain labels, and keeps unknown ones under Other', () => {
    renderPage();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['General', 'Email', 'Data pruning', 'Other']);
    expect(field('SMTP server')).toBeTruthy();
    expect(field('Retry limit')).toBeTruthy();
  });

  it('shows no save bar until something changes, and hides it again on discard', () => {
    renderPage();
    expect(saveBar()).toBeNull();
    fireEvent.change(field('Server name'), { target: { value: 'Mirthless (prod)' } });
    expect(saveBar()?.textContent).toContain('1 unsaved change');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(saveBar()).toBeNull();
    expect(field('Server name').value).toBe('Mirthless');
  });

  it('does not count a value changed back to what was saved', () => {
    renderPage();
    fireEvent.change(field('Server name'), { target: { value: 'x' } });
    fireEvent.change(field('Server name'), { target: { value: 'Mirthless' } });
    expect(saveBar()).toBeNull();
  });

  it('saves only the changed settings, keeping each type', async () => {
    renderPage();
    fireEvent.change(field('Port'), { target: { value: '465' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => { expect(bulkMutate).toHaveBeenCalledTimes(1); });
    expect(bulkMutate).toHaveBeenCalledWith({
      settings: [{ key: 'smtp.port', value: '465', type: 'number', description: null, category: 'smtp' }],
    });
    expect(scheduleMutate).not.toHaveBeenCalled();
    await waitFor(() => { expect(saveBar()).toBeNull(); });
    expect(lastNotice()).toBe('Setting saved');
  });

  it('saves with Ctrl+S', async () => {
    renderPage();
    fireEvent.change(field('Port'), { target: { value: '25' } });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => { expect(bulkMutate).toHaveBeenCalledTimes(1); });
  });

  it('blocks saving while a value is invalid and says why', () => {
    renderPage();
    fireEvent.change(field('Port'), { target: { value: '70000' } });
    expect(screen.getByText('Enter a port from 1 to 65535.')).toBeTruthy();
    expect(saveBar()?.textContent).toContain('Fix the highlighted value to save');
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(bulkMutate).not.toHaveBeenCalled();
  });

  it('never puts a stored secret in the field and sends only a newly typed one', async () => {
    renderPage();
    const pass = field('Password');
    expect(pass.value).toBe('');
    expect(pass.placeholder).toBe('Saved. Type to replace.');
    expect(pass.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show Password' }));
    expect(field('Password').type).toBe('text');
    fireEvent.change(field('Password'), { target: { value: 'n3w-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => { expect(bulkMutate).toHaveBeenCalledTimes(1); });
    expect(bulkMutate.mock.calls[0]?.[0]).toEqual({
      settings: [{ key: 'smtp.auth_pass', value: 'n3w-secret', type: 'password', description: null, category: 'smtp' }],
    });
  });

  it('saves pruner settings through the pruner schedule so the schedule changes at once', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('switch', { name: 'Prune on a schedule' }));
    fireEvent.change(field('Schedule'), { target: { value: '30 1 * * *' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => { expect(scheduleMutate).toHaveBeenCalledWith({ enabled: true, cronExpression: '30 1 * * *' }); });
    expect(bulkMutate).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalled();
    await waitFor(() => { expect(lastNotice()).toBe('2 settings saved'); });
  });

  it('keeps the changes and reports the error when saving fails', async () => {
    bulkMutate.mockRejectedValue(new Error('database unavailable'));
    renderPage();
    fireEvent.change(field('Server name'), { target: { value: 'Prod' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => { expect(lastNotice()).toBe('Not saved: database unavailable'); });
    expect(saveBar()).not.toBeNull();
    expect(field('Server name').value).toBe('Prod');
  });

  it('is read-only without settings:write', () => {
    renderPage(['settings:read']);
    expect(screen.getByText(/Read-only: changing settings needs the settings:write permission/)).toBeTruthy();
    expect(field('Server name').disabled).toBe(true);
    expect((screen.getByRole('switch', { name: 'Prune on a schedule' }) as HTMLInputElement).disabled).toBe(true);
  });
});
