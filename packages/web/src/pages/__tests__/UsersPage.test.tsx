// ===========================================
// UsersPage Tests
// ===========================================
// Enabled state is one switch per row, like every other admin list. Disabling
// asks first (the user loses sign-in) and needs users:delete; enabling is one
// click and needs users:write. Data and permission hooks are mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../styles/theme.js';

const ALL = ['users:read', 'users:write', 'users:delete'];
let granted: readonly string[] = ALL;
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
const updateAsync = vi.fn();
const passwordAsync = vi.fn();
const mutation = (mutate = vi.fn(), mutateAsync = vi.fn()): Record<string, unknown> => ({ mutate, mutateAsync, isPending: false });

function user(id: string, username: string, enabled: boolean): Record<string, unknown> {
  return { id, username, email: `${username}@example.test`, firstName: null, lastName: null, role: 'deployer', enabled, lastLoginAt: null };
}

vi.mock('../../hooks/use-permissions.js', () => ({
  usePermissions: () => ({ has: (p: string) => granted.includes(p) }),
}));

vi.mock('../../hooks/use-users.js', () => ({
  useUsers: () => ({ data: [user('u1', 'jmorales', true), user('u2', 'kpatel', false)], isLoading: false, error: null, isFetching: false, refetch: vi.fn() }),
  useCreateUser: () => mutation(),
  useUpdateUser: () => mutation(updateMutate, updateAsync),
  useDeleteUser: () => mutation(deleteMutate),
  useChangePassword: () => mutation(vi.fn(), passwordAsync),
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

beforeEach(() => {
  updateMutate.mockReset();
  deleteMutate.mockReset();
  // The server answers an update with the saved user.
  updateAsync.mockReset().mockImplementation(({ input }: { input: Record<string, unknown> }) => (
    Promise.resolve({ ...user('u1', 'jmorales', true), ...input })
  ));
  passwordAsync.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); });

describe('UsersPage edit dialog password change', () => {
  function editJmorales(email: string | null, password: string): void {
    renderPage();
    const [edit] = screen.getAllByRole('button', { name: 'Edit user' });
    if (!edit) throw new Error('no Edit user button');
    fireEvent.click(edit);
    if (email !== null) fireEvent.change(screen.getByLabelText(/Email/), { target: { value: email } });
    fireEvent.change(screen.getByLabelText(/New Password/), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  }

  it('keeps the dialog open and shows the error when the password change is refused after a details change', async () => {
    passwordAsync.mockRejectedValue(new Error('Password must contain a digit'));

    editJmorales('jm@example.test', 'weakpassword');

    expect(await screen.findByText(/Password must contain a digit/)).toBeTruthy();
    expect(screen.getByText(/details were saved/i)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(updateAsync).toHaveBeenCalledWith({ id: 'u1', input: { email: 'jm@example.test' } });
    expect(passwordAsync).toHaveBeenCalledWith({ id: 'u1', newPassword: 'weakpassword' });
  });

  it('retries only the password after a refused one, without saving the details again', async () => {
    passwordAsync.mockRejectedValueOnce(new Error('Password must contain a digit'));
    editJmorales('jm@example.test', 'weakpassword');
    expect(await screen.findByText(/details were saved/i)).toBeTruthy();
    // The dialog now edits the saved user, which clears the refused password.
    await waitFor(() => { expect((screen.getByLabelText(/New Password/) as HTMLInputElement).value).toBe(''); });
    expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe('jm@example.test');

    fireEvent.change(screen.getByLabelText(/New Password/), { target: { value: 'Str0ngPassword' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    expect(updateAsync).toHaveBeenCalledTimes(1);
    expect(passwordAsync).toHaveBeenLastCalledWith({ id: 'u1', newPassword: 'Str0ngPassword' });
  });

  it('closes the dialog once both the details and the password are saved', async () => {
    editJmorales('jm@example.test', 'Str0ngPassword');

    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    expect(passwordAsync).toHaveBeenCalledWith({ id: 'u1', newPassword: 'Str0ngPassword' });
  });

  it('sends a short password to the server instead of dropping it, and shows the refusal', async () => {
    passwordAsync.mockRejectedValue(new Error('Password must be at least 8 characters'));

    editJmorales(null, 'short1');

    expect(await screen.findByText(/at least 8 characters/)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(updateAsync).not.toHaveBeenCalled();
  });

  it('keeps the dialog open when the details update is refused, and does not change the password', async () => {
    updateAsync.mockRejectedValue(new Error('Email already in use'));

    editJmorales('taken@example.test', 'Str0ngPassword');

    expect(await screen.findByText('Email already in use')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(passwordAsync).not.toHaveBeenCalled();
  });
});

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
