// ===========================================
// Socket Connection & Event Hooks
// ===========================================
// React hooks for managing socket.io lifecycle and event subscriptions.

import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/auth.store.js';
import { connectSocket, disconnectSocket, getSocket } from '../lib/socket.js';
import { queryClient } from '../providers/QueryProvider.js';

/**
 * Manages the socket.io connection lifecycle tied to authentication state.
 * Call once at the top level of the authenticated layout (AppLayout).
 *
 * - Connects when authenticated, disconnects on logout or unmount.
 * - Invalidates all TanStack queries on reconnection (stale data refresh).
 * - Stops reconnection attempts on auth errors to prevent token-expired loops.
 */
export function useSocketConnection(): void {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const accessToken = useAuthStore((state) => state.accessToken);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  // Track whether this is a reconnection (not the initial connect)
  const hasConnectedOnce = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      disconnectSocket();
      hasConnectedOnce.current = false;
      return;
    }

    const socket = connectSocket(accessToken);

    const handleConnect = (): void => {
      if (hasConnectedOnce.current) {
        // Reconnection — invalidate all queries to refresh potentially stale data
        void queryClient.invalidateQueries();
      }
      hasConnectedOnce.current = true;
    };

    const handleConnectError = (err: Error): void => {
      // If the server rejects authentication, stop retrying to prevent loops
      const message = err.message.toLowerCase();
      if (message.includes('auth') || message.includes('unauthorized') || message.includes('jwt')) {
        socket.disconnect();
        clearAuth();
      }
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);

    return (): void => {
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      disconnectSocket();
      hasConnectedOnce.current = false;
    };
  }, [isAuthenticated, accessToken, clearAuth]);
}

/**
 * Subscribe to a socket.io event. Cleans up on unmount.
 * No-ops gracefully if the socket is not connected.
 *
 * @param event - The socket event name to listen for
 * @param handler - Callback invoked with the event payload
 */
export function useSocketEvent(event: string, handler: (data: unknown) => void): void {
  // Store handler in a ref to avoid re-subscribing on every render
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      return;
    }

    const wrappedHandler = (data: unknown): void => {
      handlerRef.current(data);
    };

    socket.on(event, wrappedHandler);

    return (): void => {
      socket.off(event, wrappedHandler);
    };
  }, [event]);
}
