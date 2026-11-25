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
  usePermissions: () => ({ has: (p: string) => granted.includes(p), permissions: new Set(granted) }),
}));

vi.mock('../../hooks/use-roles.js', () => ({
  useRoles: () => ({ data: undefined, error: null }),
}));

// The access list stays loading: the details and password save without it.
// e2e/assignments.spec.ts covers the access list.
const setAssignmentsAsync = vi.fn();
vi.mock('../../hooks/use-assignments.js', () => ({
  useAssignments: () => ({ data: undefined, isError: false, dataUpdatedAt: 0 }),
  useSetAssignments: () => ({ mutateAsync: setAssignmentsAsync, isPending: false }),
}));

let issuedKeys: readonly Record<string, unknown>[] = [];
let grants: readonly Record<string, unknown>[] = [];
let myId = 'me';
vi.mock('../../stores/auth.store.js', () => ({
  useAuthStore: (pick: (s: { user: { id: string; grants: readonly Record<string, unknown>[] } }) => unknown) => pick({ user: { id: myId, grants } }),
}));
const reloadKeys = vi.fn();
vi.mock('../../hooks/use-channel-groups.js', () => ({ useChannelGroups: () => ({ data: [] }) }));
vi.mock('../../hooks/use-api-keys.js', () => ({
  useApiKeys: (enabled: boolean) => ({ data: enabled ? issuedKeys : undefined, refetch: reloadKeys }),
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
  issuedKeys = [];
  grants = [];
  myId = 'me';
  reloadKeys.mockReset();
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

describe('UsersPage editing your own account', () => {
  function openEdit(row: number): void {
    const edit = screen.getAllByRole('button', { name: 'Edit user' })[row];
    if (!edit) throw new Error(`no Edit user button in row ${String(row)}`);
    fireEvent.click(edit);
  }

  it('offers no password field, and says where to change it', () => {
    myId = 'u1';
    renderPage();

    openEdit(0);

    expect(screen.getByLabelText(/Email/)).toBeTruthy();
    expect(screen.queryByLabelText(/Password/)).toBeNull();
    expect(screen.getByText(/Change Password in the account menu/)).toBeTruthy();
  });

  it('still saves the other details, and sends no password', async () => {
    myId = 'u1';
    renderPage();

    openEdit(0);
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'jm@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    expect(updateAsync).toHaveBeenCalledWith({ id: 'u1', input: { email: 'jm@example.test' } });
    expect(passwordAsync).not.toHaveBeenCalled();
  });

  it('keeps the password field for another user', () => {
    myId = 'u1';
    renderPage();

    openEdit(1);

    expect(screen.getByLabelText(/New Password/)).toBeTruthy();
    expect(screen.queryByText(/Change Password in the account menu/)).toBeNull();
  });

  it('keeps the password field for a new user', () => {
    myId = 'u1';
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));

    expect(screen.getByLabelText(/^Password/)).toBeTruthy();
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

  it('disables a user with a plain confirm when they issued no working key', () => {
    renderPage();
    fireEvent.click(switchFor('Disable jmorales'));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(deleteMutate).toHaveBeenCalledWith({ id: 'u1' });
  });

  it('warns that a leaver\'s keys stop, and sends the keys a key manager takes over', () => {
    issuedKeys = [{ id: 'k1', name: 'Lab feed', permissions: ['channels:read'], groupIds: null, status: 'active', issuedBy: { id: 'u1', username: 'jmorales' } }];
    grants = [{ permission: 'channels:read', scope: 'all' }];
    renderPage([...ALL, 'api_keys:read', 'api_keys:manage']);
    fireEvent.click(switchFor('Disable jmorales'));
    expect(screen.getByText(/1 API key they issued will stop now/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Take ownership of Lab feed'));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(deleteMutate).toHaveBeenCalledWith({ id: 'u1', takeOwnership: ['k1'] }, expect.anything());
  });

  it('reads the keys again when it asks, so when each was last used is not from hours ago', () => {
    renderPage([...ALL, 'api_keys:read']);
    expect(reloadKeys).not.toHaveBeenCalled();
    fireEvent.click(switchFor('Disable jmorales'));
    expect(reloadKeys).toHaveBeenCalledOnce();
    cleanup();
    reloadKeys.mockReset();
    renderPage();
    fireEvent.click(switchFor('Disable jmorales'));
    expect(reloadKeys).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the server\'s reason when the disable is refused', () => {
    issuedKeys = [{ id: 'k1', name: 'Lab feed', permissions: ['channels:read'], groupIds: null, status: 'active', issuedBy: { id: 'u1', username: 'jmorales' } }];
    grants = [{ permission: 'channels:read', scope: 'all' }];
    deleteMutate.mockImplementation((_vars: unknown, options: { onError: (e: Error) => void }) => { options.onError(new Error('A key cannot outlast your own access')); });
    renderPage([...ALL, 'api_keys:read', 'api_keys:manage']);
    fireEvent.click(switchFor('Disable jmorales'));
    fireEvent.click(screen.getByLabelText('Take ownership of Lab feed'));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(screen.getByText(/cannot outlast your own access/)).toBeTruthy();
    expect(screen.getByText(/API key they issued will stop now|being taken over/)).toBeTruthy();
  });

  it('warns a key reader without api_keys:manage, but offers no take-over', () => {
    issuedKeys = [{ id: 'k1', name: 'Lab feed', permissions: ['channels:read'], groupIds: null, status: 'active', issuedBy: { id: 'u1', username: 'jmorales' } }];
    grants = [{ permission: 'channels:read', scope: 'all' }];
    renderPage([...ALL, 'api_keys:read']);
    fireEvent.click(switchFor('Disable jmorales'));
    expect(screen.getByText(/1 API key they issued will stop now/)).toBeTruthy();
    expect(screen.queryByLabelText('Take ownership of Lab feed')).toBeNull();
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
