// ===========================================
// UsersPage Tests
// ===========================================
// Enabled state is one switch per row, like every other admin list. Disabling
// asks first (the user loses sign-in) and needs users:delete; enabling is one
// click and needs users:write. Data and permission hooks are mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../styles/theme.js';

const ALL = ['users:read', 'users:write', 'users:delete'];
let granted: readonly string[] = ALL;
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
const mutation = (mutate = vi.fn()): Record<string, unknown> => ({ mutate, mutateAsync: vi.fn(), isPending: false });

function user(id: string, username: string, enabled: boolean): Record<string, unknown> {
  return { id, username, email: `${username}@example.test`, firstName: null, lastName: null, role: 'deployer', enabled, lastLoginAt: null };
}

vi.mock('../../hooks/use-permissions.js', () => ({
  usePermissions: () => ({ has: (p: string) => granted.includes(p) }),
}));

vi.mock('../../hooks/use-users.js', () => ({
  useUsers: () => ({ data: [user('u1', 'jmorales', true), user('u2', 'kpatel', false)], isLoading: false, error: null, isFetching: false, refetch: vi.fn() }),
  useCreateUser: () => mutation(),
  useUpdateUser: () => mutation(updateMutate),
  useDeleteUser: () => mutation(deleteMutate),
  useChangePassword: () => mutation(),
  useUnlockUser: () => mutation(),
}));

import { UsersPage } from '../UsersPage.js';

function renderPage(permissions: readonly string[] = ALL): void {
  granted = permissions;
  render(
    <ThemeProvider theme={lightTheme}>
      <MemoryRouter><UsersPage /></MemoryRouter>
    </ThemeProvider>,
  );
}

const switchFor = (name: string): HTMLInputElement => screen.getByRole('switch', { name }) as HTMLInputElement;

beforeEach(() => { updateMutate.mockReset(); deleteMutate.mockReset(); });
afterEach(() => { cleanup(); });

describe('UsersPage enabled switch', () => {
  it('shows roles as sentence-case labels', () => {
    renderPage();
    expect(screen.getAllByText('Deployer')).toHaveLength(2);
  });

  it('enables a disabled user with one click', () => {
    renderPage();
    fireEvent.click(switchFor('Enable kpatel'));
    expect(updateMutate).toHaveBeenCalledWith({ id: 'u2', input: { enabled: true } });
  });

  it('asks before disabling and names the user', () => {
    renderPage();
    fireEvent.click(switchFor('Disable jmorales'));
    expect(deleteMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Disable jmorales\?/)).toBeTruthy();
  });

  it('locks disabling without users:delete and enabling without users:write', () => {
    renderPage(['users:read', 'users:write']);
    expect(switchFor('Disable jmorales').disabled).toBe(true);
    expect(switchFor('Enable kpatel').disabled).toBe(false);
    cleanup();
    renderPage(['users:read']);
    expect(switchFor('Enable kpatel').disabled).toBe(true);
  });
});
