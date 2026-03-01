// ===========================================
// Socket.IO Client
// ===========================================
// Manages a singleton Socket.IO connection to the server.
// Stub — full implementation provided by Unit 4.

import { type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** Get the current socket instance (or null if not connected). */
export function getSocket(): Socket | null {
  return socket;
}

/** Connect to the server with JWT auth. Stub — implemented in Unit 4. */
export function connectSocket(_token: string): Socket {
  // Stub - implemented in Unit 4
  return socket as unknown as Socket;
}

/** Disconnect and discard the socket instance. */
export function disconnectSocket(): void {
  socket = null;
}
