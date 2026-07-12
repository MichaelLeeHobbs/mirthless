// ===========================================
// RequirePermission Route Guard Tests
// ===========================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequirePermission } from '../RequirePermission.js';
import { useAuthStore } from '../../../stores/auth.store.js';
import { PERMISSION } from '../../../lib/permissions.js';

function setPermissions(permissions: readonly string[]): void {
  useAuthStore.setState({
    user: { id: 'u1', username: 't', email: 't@x.com', role: 'viewer', permissions },
    accessToken: 'tok',
    isAuthenticated: true,
  });
}

function renderGuarded(): void {
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route element={<RequirePermission anyOf={[PERMISSION.USERS_READ]} />}>
          <Route path="/admin" element={<div>Secret Admin Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequirePermission', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the guarded route when the user holds the permission', () => {
    setPermissions([PERMISSION.USERS_READ]);
    renderGuarded();
    expect(screen.queryByText('Secret Admin Content')).toBeTruthy();
    expect(screen.queryByText('Not authorized')).toBeNull();
  });

  it('blocks the guarded route with a notice when the permission is missing', () => {
    setPermissions([PERMISSION.CHANNELS_READ]);
    renderGuarded();
    expect(screen.queryByText('Secret Admin Content')).toBeNull();
    expect(screen.queryByText('Not authorized')).toBeTruthy();
  });
});
