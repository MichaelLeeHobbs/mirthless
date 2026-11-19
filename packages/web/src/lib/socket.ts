import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/auth.store.js';

let socket: Socket | null = null;
let unsubscribeAuth: (() => void) | null = null;

function getServerUrl(): string {
  const envUrl: string | undefined = import.meta.env['VITE_API_URL'] as string | undefined;
  if (envUrl) {
    return envUrl;
  }
  return window.location.origin;
}

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

  unsubscribeAuth = useAuthStore.subscribe((state, prevState) => {
    if (
      state.accessToken &&
      state.accessToken !== prevState.accessToken &&
      socket
    ) {
      socket.auth = { token: state.accessToken };
      // A socket the server refused (e.g. while a password change was required)
      // does not retry on its own, so connect it too.
      if (socket.connected) {
        socket.disconnect().connect();
      } else {
        socket.connect();
      }
    }
  });

  return socket;
}

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

export function getSocket(): Socket | null {
  return socket;
}
