// ===========================================
// useSocketConnection Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type Listener = (arg: Error) => void;

const fakeSocket = vi.hoisted(() => {
  const listeners = new Map<string, Listener>();
  const s = {
    connected: false,
    auth: {} as Record<string, unknown>,
    listeners,
    on: vi.fn((event: string, fn: Listener) => { listeners.set(event, fn); return s; }),
    off: vi.fn(() => s),
    removeAllListeners: vi.fn(() => s),
    connect: vi.fn(() => s),
    disconnect: vi.fn(() => s),
  };
  return s;
});

const io = vi.hoisted(() => vi.fn(() => fakeSocket));
vi.mock('socket.io-client', () => ({ io }));

const { useSocketConnection } = await import('../use-socket.js');
const { useAuthStore } = await import('../../stores/auth.store.js');

const USER = { id: 'u1', username: 'admin', email: 'a@example.com', role: 'admin', permissions: [] };

describe('useSocketConnection', () => {
  beforeEach(() => {
    fakeSocket.listeners.clear();
  });

  afterEach(() => {
    useAuthStore.getState().clearAuth();
    vi.clearAllMocks();
  });

  it('does not open a socket while a forced password change is pending', () => {
    useAuthStore.getState().setAuth(USER, 'token', true);

    renderHook(() => { useSocketConnection(); });

    expect(io).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('connects once the forced password change is done', () => {
    useAuthStore.getState().setAuth(USER, 'token', true);
    renderHook(() => { useSocketConnection(); });

    act(() => { useAuthStore.getState().clearMustChangePassword(); });

    expect(io).toHaveBeenCalledTimes(1);
  });

  it('logs out when the server rejects the socket for an auth reason', () => {
    useAuthStore.getState().setAuth(USER, 'token', false);
    renderHook(() => { useSocketConnection(); });

    act(() => { fakeSocket.listeners.get('connect_error')?.(new Error('Authentication required')); });

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
