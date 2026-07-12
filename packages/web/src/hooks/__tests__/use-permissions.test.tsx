// ===========================================
// usePermissions Tests
// ===========================================

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePermissions } from '../use-permissions.js';
import { useAuthStore } from '../../stores/auth.store.js';
import { PERMISSION } from '../../lib/permissions.js';

function setPermissions(permissions: readonly string[]): void {
  useAuthStore.setState({
    user: {
      id: 'u1',
      username: 'tester',
      email: 't@example.com',
      role: 'viewer',
      permissions,
    },
    accessToken: 'token',
    isAuthenticated: true,
  });
}

describe('usePermissions', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false });
  });

  it('reports has() true only for granted permissions', () => {
    setPermissions([PERMISSION.CHANNELS_READ, PERMISSION.CHANNELS_WRITE]);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.has(PERMISSION.CHANNELS_WRITE)).toBe(true);
    expect(result.current.has(PERMISSION.CHANNELS_DELETE)).toBe(false);
  });

  it('treats a user with no permissions as having none', () => {
    setPermissions([]);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.has(PERMISSION.CHANNELS_READ)).toBe(false);
    expect(result.current.hasAny([PERMISSION.CHANNELS_READ, PERMISSION.USERS_READ])).toBe(false);
  });

  it('treats an unauthenticated user (null) as having none', () => {
    const { result } = renderHook(() => usePermissions());
    expect(result.current.has(PERMISSION.CHANNELS_READ)).toBe(false);
    expect(result.current.permissions.size).toBe(0);
  });

  it('hasAny is true when at least one permission is present', () => {
    setPermissions([PERMISSION.USERS_READ]);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasAny([PERMISSION.SETTINGS_WRITE, PERMISSION.USERS_READ])).toBe(true);
    expect(result.current.hasAny([PERMISSION.SETTINGS_WRITE, PERMISSION.SYSTEM_BACKUP])).toBe(false);
  });

  it('hasAll requires every permission', () => {
    setPermissions([PERMISSION.CHANNELS_READ, PERMISSION.CHANNELS_WRITE]);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasAll([PERMISSION.CHANNELS_READ, PERMISSION.CHANNELS_WRITE])).toBe(true);
    expect(result.current.hasAll([PERMISSION.CHANNELS_READ, PERMISSION.CHANNELS_DEPLOY])).toBe(false);
  });
});
