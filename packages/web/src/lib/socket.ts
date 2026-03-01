// ===========================================
// Socket.IO Client Singleton
// ===========================================
// Manages a single socket.io-client instance with JWT authentication.
// Subscribes to auth store changes to update the token on refresh.

import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/auth.store.js';

let socket: Socket | null = null;
let unsubscribeAuth: (() => void) | null = null;

/** Resolve the server URL for socket.io connection */
function getServerUrl(): string {
  const envUrl: string | undefined = import.meta.env['VITE_API_URL'] as string | undefined;
  if (envUrl) {
    return envUrl;
  }
  return window.location.origin;
}

/**
 * Create and connect the socket.io singleton with JWT auth.
 * If a socket already exists, disconnects it first.
 */
export function connectSocket(token: string): Socket {
  if (socket) {
    disconnectSocket();
  }

  socket = io(getServerUrl(), {
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });

  if (import.meta.env.DEV) {
    socket.on('disconnect', (reason: string) => {
      // eslint-disable-next-line no-console
      console.log('[socket] disconnected:', reason);
    });

    socket.on('connect', () => {
      // eslint-disable-next-line no-console
      console.log('[socket] connected, id:', socket?.id);
    });
  }

  // Subscribe to auth store token changes for transparent token refresh
  unsubscribeAuth = useAuthStore.subscribe((state, prevState) => {
    if (
      state.accessToken &&
      state.accessToken !== prevState.accessToken &&
      socket
    ) {
      socket.auth = { token: state.accessToken };
      // Reconnect with new token if currently connected
      if (socket.connected) {
        socket.disconnect().connect();
      }
    }
  });

  return socket;
}

/** Disconnect and destroy the socket singleton */
export function disconnectSocket(): void {
  if (unsubscribeAuth) {
    unsubscribeAuth();
    unsubscribeAuth = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/** Get the current socket instance, or null if not connected */
export function getSocket(): Socket | null {
  return socket;
}
