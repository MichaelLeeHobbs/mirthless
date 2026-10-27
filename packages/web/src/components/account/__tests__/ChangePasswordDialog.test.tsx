// ===========================================
// ChangePasswordDialog Tests (forced change)
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChangePasswordDialog } from '../ChangePasswordDialog.js';
import { useAuthStore } from '../../../stores/auth.store.js';

const postMock = vi.fn();

vi.mock('../../../api/client.js', () => ({
  api: {
    post: (path: string, body: unknown) => postMock(path, body),
  },
  apiFetch: vi.fn(),
}));

const USER = { id: 'u1', username: 'admin', email: 'a@example.com', role: 'admin', permissions: [] };

function renderForced(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChangePasswordDialog forced open onClose={() => { /* forced */ }} />
    </QueryClientProvider>,
  );
  return client;
}

function submit(): void {
  fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'Admin123!' } });
  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'NewPassw0rd!' } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'NewPassw0rd!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
}

describe('ChangePasswordDialog (forced)', () => {
  beforeEach(() => {
    postMock.mockReset();
    useAuthStore.getState().setAuth(USER, 'token', true);
  });

  it('clears the forced flag and refetches the queries the server refused', async () => {
    postMock.mockResolvedValue({ success: true, data: undefined });
    const client = renderForced();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    submit();

    await waitFor(() => { expect(useAuthStore.getState().mustChangePassword).toBe(false); });
    expect(postMock).toHaveBeenCalledWith('/users/me/password', { currentPassword: 'Admin123!', newPassword: 'NewPassw0rd!' });
    expect(invalidate).toHaveBeenCalledWith();
  });

  it('keeps the forced flag, shows the error and refetches nothing when the change fails', async () => {
    postMock.mockResolvedValue({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' } });
    const client = renderForced();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    submit();

    expect(await screen.findByText('Current password is incorrect')).toBeDefined();
    expect(useAuthStore.getState().mustChangePassword).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
