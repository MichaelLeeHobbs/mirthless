import { useEffect, useRef, useState } from 'react';
import { createThrottle } from '@galvanigraph/core-util';
import { useAuthStore } from '../stores/auth.store.js';
import { connectSocket, disconnectSocket, getSocket } from '../lib/socket.js';
import { queryClient } from '../providers/QueryProvider.js';
import { refreshOrSignOut } from '../api/client.js';
import { SOCKET_ERROR } from '@galvanigraph/core-models';

export const SOCKET_RETRY_MS = 10_000;

/**
 * Call once, in the authenticated layout. Waits out a forced password change:
 * the server refuses the handshake until then, and that refusal must not sign
 * the user out.
 */
export function useSocketConnection(): void {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const accessToken = useAuthStore((state) => state.accessToken);
  const mustChangePassword = useAuthStore((state) => state.mustChangePassword);

  const hasConnectedOnce = useRef(false);
  // The token the last socket-triggered refresh gave, so a refused one is not refreshed again.
  const refreshedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !accessToken || mustChangePassword) {
      disconnectSocket();
      hasConnectedOnce.current = false;
      return;
    }

    const socket = connectSocket(accessToken);
    let retry: ReturnType<typeof setTimeout> | undefined;

    const handleConnect = (): void => {
      if (hasConnectedOnce.current) {
        // Events may have been missed while disconnected.
        void queryClient.invalidateQueries();
      }
      hasConnectedOnce.current = true;
    };

    const handleConnectError = (err: Error): void => {
      // socket.io does not retry a handshake the server refused, and this refusal
      // says nothing about the token (#473).
      if (err.message === SOCKET_ERROR.UNAVAILABLE) {
        clearTimeout(retry);
        retry = setTimeout(() => { socket.connect(); }, SOCKET_RETRY_MS);
        return;
      }
      // Stop retrying, or a refused token loops.
      const message = err.message.toLowerCase();
      if (message.includes('auth') || message.includes('unauthorized') || message.includes('jwt')) {
        socket.disconnect();
        // The token may be one a refresh just rotated (a background access check,
        // or a 401 elsewhere): refresh, and sign out only if that is refused. A new
        // token re-runs this effect and reconnects. A token a refresh just gave
        // that is refused too will not be fixed by another refresh: sign out.
        if (refreshedFor.current === accessToken) {
          useAuthStore.getState().clearAuth();
          return;
        }
        void refreshOrSignOut().then((fresh) => { refreshedFor.current = fresh; });
      }
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);

    return (): void => {
      clearTimeout(retry);
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      disconnectSocket();
      hasConnectedOnce.current = false;
    };
  }, [isAuthenticated, accessToken, mustChangePassword]);
}

/** Does nothing if there is no socket when it mounts. */
export function useSocketEvent<T = unknown>(event: string, handler: (data: T) => void): void {
  // Store handler in a ref to avoid re-subscribing on every render
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      return;
    }

    const wrappedHandler = (data: T): void => {
      handlerRef.current(data);
    };

    socket.on(event, wrappedHandler);

    return (): void => {
      socket.off(event, wrappedHandler);
    };
  }, [event]);
}

/**
 * The shortest time between two runs of a live-event handler (D-306). The server
 * already coalesces these events to one a second per room; this bounds the
 * refetches each open page makes.
 */
export const LIVE_REFRESH_INTERVAL_MS = 2_000;

/**
 * The event payload is not passed on. A pending run is dropped when `scope`
 * changes, so a run due for one channel does not fire for the next one shown.
 */
export function useThrottledSocketEvent(event: string, handler: () => void, scope = ''): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const [throttle] = useState(() => createThrottle(() => { handlerRef.current(); }, LIVE_REFRESH_INTERVAL_MS));

  useEffect(() => () => { throttle.cancel(); }, [throttle, scope]);
  useSocketEvent(event, throttle.call);
}

/** An empty string arg (a channel id not known yet) skips the join. */
export function useSocketRoom(joinEvent: string, leaveEvent: string, ...args: readonly unknown[]): void {
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    if (args.some((a) => typeof a === 'string' && a.length === 0)) return;
    s.emit(joinEvent, ...args);
    const handleReconnect = (): void => { s.emit(joinEvent, ...args); };
    s.on('connect', handleReconnect);
    return () => {
      s.off('connect', handleReconnect);
      s.emit(leaveEvent, ...args);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinEvent, leaveEvent, ...args]);
}
