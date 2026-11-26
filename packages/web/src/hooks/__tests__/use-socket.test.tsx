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

const { useSocketConnection, useThrottledSocketEvent, LIVE_REFRESH_INTERVAL_MS, SOCKET_RETRY_MS, SOCKET_RETRY_JITTER_MS } = await import('../use-socket.js');
const { SOCKET_ERROR } = await import('@galvanigraph/core-models');
const { connectSocket, disconnectSocket } = await import('../../lib/socket.js');
const { useAuthStore } = await import('../../stores/auth.store.js');

const USER = { id: 'u1', username: 'admin', email: 'a@example.com', role: 'admin', permissions: [] };

describe('useSocketConnection', () => {
  beforeEach(() => {
    fakeSocket.listeners.clear();
  });

  afterEach(() => {
    useAuthStore.getState().clearAuth();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
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

  it('logs out when the server rejects the socket for an auth reason and the refresh is refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    useAuthStore.getState().setAuth(USER, 'token', false);
    renderHook(() => { useSocketConnection(); });

    act(() => { fakeSocket.listeners.get('connect_error')?.(new Error('Authentication required')); });

    await vi.waitFor(() => { expect(useAuthStore.getState().isAuthenticated).toBe(false); });
  });

  it('signs out rather than refreshing again when the token a refresh just gave is refused too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { accessToken: 'fresh-token' } }), { status: 200 })));
    useAuthStore.getState().setAuth(USER, 'token', false);
    renderHook(() => { useSocketConnection(); });
    act(() => { fakeSocket.listeners.get('connect_error')?.(new Error('Authentication required')); });
    await vi.waitFor(() => { expect(useAuthStore.getState().accessToken).toBe('fresh-token'); });

    act(() => { fakeSocket.listeners.get('connect_error')?.(new Error('Authentication required')); });

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('stays signed in and tries again later when the server cannot check the handshake (#473)', () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      useAuthStore.getState().setAuth(USER, 'token', false);
      renderHook(() => { useSocketConnection(); });

      act(() => { fakeSocket.listeners.get('connect_error')?.(new Error(SOCKET_ERROR.UNAVAILABLE)); });
      act(() => { vi.advanceTimersByTime(SOCKET_RETRY_MS - 1); });
      expect(fakeSocket.connect).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(SOCKET_RETRY_JITTER_MS + 1); });

      expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not try again after the page that opened the socket has gone', () => {
    vi.useFakeTimers();
    try {
      useAuthStore.getState().setAuth(USER, 'token', false);
      const { unmount } = renderHook(() => { useSocketConnection(); });

      act(() => { fakeSocket.listeners.get('connect_error')?.(new Error(SOCKET_ERROR.UNAVAILABLE)); });
      unmount();
      act(() => { vi.advanceTimersByTime(SOCKET_RETRY_MS + SOCKET_RETRY_JITTER_MS); });

      expect(fakeSocket.connect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnects later a socket the server closed, but not one the page closed', () => {
    vi.useFakeTimers();
    try {
      useAuthStore.getState().setAuth(USER, 'token', false);
      renderHook(() => { useSocketConnection(); });
      const disconnected = fakeSocket.listeners.get('disconnect') as unknown as (reason: string) => void;

      act(() => { disconnected('io client disconnect'); });
      act(() => { vi.advanceTimersByTime(SOCKET_RETRY_MS + SOCKET_RETRY_JITTER_MS); });
      expect(fakeSocket.connect).not.toHaveBeenCalled();

      act(() => { disconnected('io server disconnect'); });
      act(() => { vi.advanceTimersByTime(SOCKET_RETRY_MS + SOCKET_RETRY_JITTER_MS); });
      expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays signed in when a refresh replaces a token the server had just rotated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { accessToken: 'fresh-token' } }), { status: 200 })));
    useAuthStore.getState().setAuth(USER, 'token', false);
    renderHook(() => { useSocketConnection(); });

    act(() => { fakeSocket.listeners.get('connect_error')?.(new Error('Authentication required')); });

    await vi.waitFor(() => { expect(useAuthStore.getState().accessToken).toBe('fresh-token'); });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});

// A busy channel must not make every open page refetch once per event (#231, D-306).
describe('useThrottledSocketEvent', () => {
  const fire = (event: string, times: number): void => {
    const listener = fakeSocket.listeners.get(event);
    if (!listener) throw new Error(`no listener for ${event}`);
    act(() => { for (let i = 0; i < times; i++) listener(new Error('payload is ignored')); });
  };

  beforeEach(() => {
    fakeSocket.listeners.clear();
    vi.useFakeTimers();
    connectSocket('token');
  });

  afterEach(() => {
    disconnectSocket();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('runs the handler once at once and once more at the end of the window for a burst', () => {
    const handler = vi.fn();
    renderHook(() => { useThrottledSocketEvent('stats:update', handler); });

    fire('stats:update', 100);
    expect(handler).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS); });
    expect(handler).toHaveBeenCalledTimes(2);

    act(() => { vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 5); });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('runs at most once per window under steady events, and the last event is always followed by a run', () => {
    const handler = vi.fn();
    renderHook(() => { useThrottledSocketEvent('message:new', handler); });

    // One event every 100 ms for just under three windows.
    for (let t = 0; t < LIVE_REFRESH_INTERVAL_MS * 3 - 500; t += 100) {
      fire('message:new', 1);
      act(() => { vi.advanceTimersByTime(100); });
    }
    expect(handler).toHaveBeenCalledTimes(3);

    act(() => { vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS); });
    expect(handler).toHaveBeenCalledTimes(4);
  });

  it('calls the latest handler, not the one from the first render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ h }) => { useThrottledSocketEvent('stats:update', h); }, { initialProps: { h: first } });
    rerender({ h: second });

    fire('stats:update', 1);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('drops a run pending for the previous scope when the scope changes', () => {
    const handler = vi.fn();
    const { rerender } = renderHook(({ scope }) => { useThrottledSocketEvent('message:new', handler, scope); }, { initialProps: { scope: 'channel-a' } });

    fire('message:new', 3);
    rerender({ scope: 'channel-b' });
    act(() => { vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 2); });
    expect(handler).toHaveBeenCalledTimes(1);

    // The new scope starts with no open window.
    fire('message:new', 1);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('drops the pending run and stops listening on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => { useThrottledSocketEvent('stats:update', handler); });

    fire('stats:update', 5);
    unmount();
    act(() => { vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 2); });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(fakeSocket.off).toHaveBeenCalledWith('stats:update', expect.any(Function));
  });
});
