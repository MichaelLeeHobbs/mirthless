// ===========================================
// Auth Store Tests (mustChangePassword flow)
// ===========================================

import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../auth.store.js';

const USER = {
  id: 'u1',
  username: 'admin',
  email: 'a@example.com',
  role: 'admin',
  permissions: ['channels:read'],
} as const;

describe('auth store mustChangePassword', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clearAuth();
  });

  it('defaults to false when not passed to setAuth', () => {
    useAuthStore.getState().setAuth(USER, 'token');
    expect(useAuthStore.getState().mustChangePassword).toBe(false);
  });

  it('stores the flag from setAuth and persists it', () => {
    useAuthStore.getState().setAuth(USER, 'token', true);
    expect(useAuthStore.getState().mustChangePassword).toBe(true);
    const raw = localStorage.getItem('mirthless_auth');
    expect(raw).toContain('"mustChangePassword":true');
  });

  it('clears the flag via clearMustChangePassword while keeping auth', () => {
    useAuthStore.getState().setAuth(USER, 'token', true);
    useAuthStore.getState().clearMustChangePassword();
    const state = useAuthStore.getState();
    expect(state.mustChangePassword).toBe(false);
    expect(state.isAuthenticated).toBe(true);
    expect(state.accessToken).toBe('token');
  });

  it('resets the flag on logout', () => {
    useAuthStore.getState().setAuth(USER, 'token', true);
    useAuthStore.getState().clearAuth();
    expect(useAuthStore.getState().mustChangePassword).toBe(false);
  });

  it('preserves the flag across setAccessToken refresh', () => {
    useAuthStore.getState().setAuth(USER, 'token', true);
    useAuthStore.getState().setAccessToken('token2');
    expect(useAuthStore.getState().mustChangePassword).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe('token2');
  });
});
